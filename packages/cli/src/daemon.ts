import { type ChildProcess, spawn } from 'node:child_process';
import { hostname as osHostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_DAEMON_HEARTBEAT_INTERVAL_MS,
  collectWatchPaths,
  getAll,
  getById,
  isDevMode,
  isIndexablePlan,
  isLowValuePlan,
  loadOrInitConfig,
  type Plan,
  requestChanges,
  resolveAdapters,
  scan,
  setActiveAdapters,
  setOnPlansChanged,
  startWatching,
  stopWatchingForShutdown,
} from '@agendex/shared';
import { resolveCliAdapterIds, shouldEnablePlannotatorSync } from './adapters.ts';
import {
  fetchPlannotatorWritebacks,
  getDaemonCloudScope,
  hasDaemonCloudCredentials,
  type PlannotatorWritebackJob,
  refreshCurrentDaemonToken,
  reportPlannotatorWriteback,
  type SyncPlanPayload,
  sendHeartbeat,
  sendShutdown,
  syncPlan,
} from './api.ts';
import {
  dedupeSyncPayloads,
  DEFAULT_LIVE_SESSION_POLL_MS,
  DEFAULT_SYNC_RESCAN_INTERVAL_MS,
  DEFAULT_WATCHER_REFRESH_INTERVAL_MS,
  filterPayloadsNeedingSync,
  nextRetryDelayMs,
  parseEnvMs,
  type SyncRetryEntry,
  SYNC_MAX_RETRIES,
} from './daemon-sync.ts';
import { getLocalIpAddress } from './network.ts';
import { planToSyncPayload } from './payload.ts';
import { clearDaemonStopRequest, consumeDaemonStopRequest, removePid, writePid } from './pid.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';
import { shouldIncludeLocalIpAddressInSync } from './sync-privacy.ts';
import { syncUsageSnapshots, USAGE_SYNC_INTERVAL_MS } from './usage-sync.ts';
import {
  loadPendingWritebackReports,
  savePendingWritebackReports,
} from './writeback-delivery-cache.ts';

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 5_000;
const SUPERVISOR_WORKER_STOP_TIMEOUT_MS = 3_000;
const SUPERVISOR_WORKER_READY_TIMEOUT_MS = parseEnvMs(
  'AGENDEX_DAEMON_WORKER_READY_TIMEOUT_MS',
  30_000,
);
const PLANNOTATOR_WRITEBACK_POLL_INTERVAL_MS = 15_000;
const PLANNOTATOR_WRITEBACK_EXPIRED_ERROR = 'Write-back expired before delivery.';
const PLANNOTATOR_WRITEBACK_FAILED_ERROR =
  'No live Plannotator session accepted the write-back payload.';
// A Plannotator process can die without touching the filesystem, so file
// watchers never fire. Re-scan periodically to catch dead sessions and publish
// their "ended" state to the cloud.
const PLANNOTATOR_LIVENESS_SWEEP_INTERVAL_MS = 20_000;
const LIVE_SESSION_POLL_MS = parseEnvMs(
  'AGENDEX_LIVE_SESSION_POLL_MS',
  DEFAULT_LIVE_SESSION_POLL_MS,
);
const SYNC_RESCAN_INTERVAL_MS = parseEnvMs(
  'AGENDEX_SYNC_RESCAN_INTERVAL_MS',
  DEFAULT_SYNC_RESCAN_INTERVAL_MS,
);
const WATCHER_REFRESH_INTERVAL_MS = parseEnvMs(
  'AGENDEX_WATCHER_REFRESH_INTERVAL_MS',
  DEFAULT_WATCHER_REFRESH_INTERVAL_MS,
);
const RETRY_TICK_INTERVAL_MS = 1_000;
// Deregistering the device on the way out is best-effort. `sendShutdown` can
// otherwise burn a full HTTP timeout (plus a token refresh) against an
// unreachable cloud while the launcher waits for the worker to exit.
const REMOTE_SHUTDOWN_TIMEOUT_MS = 2_000;

export interface RunWorkerOptions {
  onStatus?: (status: { status: 'indexing'; message?: string }) => void;
  onReady?: () => void;
  registerCredentialUpdateHandler?: (handler: () => void) => void;
}

let activeShutdown: (() => Promise<void>) | null = null;
let shutdownRequested = false;
let skipRemoteShutdown = false;

export async function requestWorkerShutdown(options: { skipRemote?: boolean } = {}): Promise<void> {
  if (options.skipRemote) skipRemoteShutdown = true;
  shutdownRequested = true;
  await activeShutdown?.();
}

function withDeadline(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    void work.then(finish, finish);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * True when a sync payload represents a currently-live Plannotator session
 * (the only kind whose loopback URL is openable and that can accept write-backs).
 */
export function isLivePlannotatorPayload(payload: SyncPlanPayload): boolean {
  return isLivePlannotatorMetadata(payload.metadata);
}

function isLivePlannotatorMetadata(metadata: unknown): boolean {
  const plannotator = isRecord(metadata) ? metadata.plannotator : undefined;
  if (!isRecord(plannotator)) return false;
  return plannotator.kind === 'live-session' && plannotator.writebackCapable === true;
}

/**
 * Derive an "ended" variant of a previously-live payload: same plan identity and
 * content, but with the Plannotator metadata flipped so cloud clients stop
 * offering an open/write-back affordance for a server that is no longer running.
 */
export function buildEndedPlannotatorPayload(payload: SyncPlanPayload): SyncPlanPayload {
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const plannotator = isRecord(metadata.plannotator) ? metadata.plannotator : {};
  return {
    ...payload,
    metadata: {
      ...metadata,
      plannotator: {
        ...plannotator,
        writebackCapable: false,
        liveness: 'ended',
        endedAt: Date.now(),
      },
    },
  };
}

export async function runWorker(options: RunWorkerOptions = {}): Promise<void> {
  const config = await loadOrInitConfig();
  const hostname = osHostname();
  const cloudConfigured = hasDaemonCloudCredentials();
  const adapterIds = resolveCliAdapterIds(config, cloudConfigured);
  const adapters = resolveAdapters(adapterIds);
  setActiveAdapters(adapters);

  let syncCacheScope = getDaemonCloudScope() ?? 'unconfigured';
  let syncCache = loadSyncCache(syncCacheScope);
  const syncQueue: SyncPlanPayload[] = [];
  const retryQueue: SyncRetryEntry[] = [];
  const retryAttemptByPlanId = new Map<string, number>();
  // Tracks the updatedAt of the payload last successfully synced per plan, so a
  // delayed retry of an older failed payload can detect that a newer edit has
  // since synced and skip re-applying stale content/metadata.
  const lastSyncedUpdatedAt = new Map<string, number>();
  const pendingWritebackReports = loadPendingWritebackReports();
  // Last-synced payload for each plan id that is currently a live Plannotator
  // session. When such a plan stops being live (process died, session removed),
  // we synthesize an "ended" patch from the remembered payload so the cloud copy
  // stops advertising an open/write-back affordance. Keyed by localPlanId.
  const liveSessions = new Map<string, SyncPlanPayload>();
  let syncing = false;
  let cachedIpAddress: string | undefined;
  let includeLocalIpAddress: boolean | undefined;

  async function getSyncIpAddress(refreshPreference = false): Promise<string | undefined> {
    if (includeLocalIpAddress === undefined || refreshPreference) {
      includeLocalIpAddress = await shouldIncludeLocalIpAddressInSync();
    }
    if (!includeLocalIpAddress) {
      cachedIpAddress = undefined;
      return undefined;
    }

    cachedIpAddress ??= getLocalIpAddress();
    return cachedIpAddress;
  }

  console.log(`[agendex] daemon starting with ${adapterIds.length} adapters`);

  function refreshSyncCacheScope(): boolean {
    const nextScope = getDaemonCloudScope() ?? 'unconfigured';
    if (nextScope === syncCacheScope) return false;
    syncCacheScope = nextScope;
    syncCache = loadSyncCache(syncCacheScope);
    lastSyncedUpdatedAt.clear();
    return true;
  }

  async function tryRefreshToken(): Promise<boolean> {
    if (!(await refreshCurrentDaemonToken())) return false;
    console.log('[agendex] cloud token refreshed');
    return true;
  }

  function pushToSyncQueue(...payloads: SyncPlanPayload[]) {
    for (const payload of payloads) {
      const idx = syncQueue.findIndex((p) => p.localPlanId === payload.localPlanId);
      if (idx >= 0) {
        const existing = syncQueue[idx];
        // Never let an older payload (e.g. a delayed retry) clobber a newer one
        // that's already queued.
        if (
          existing?.updatedAt !== undefined &&
          payload.updatedAt !== undefined &&
          existing.updatedAt >= payload.updatedAt
        ) {
          continue;
        }
        syncQueue[idx] = payload;
      } else {
        syncQueue.push(payload);
      }
    }
  }

  function scheduleSyncRetry(payload: SyncPlanPayload, attempt: number) {
    const delayMs = nextRetryDelayMs(attempt);
    if (delayMs === undefined) {
      console.error(
        `[agendex] sync gave up for "${payload.title}" after ${SYNC_MAX_RETRIES} attempts`,
      );
      return;
    }
    retryQueue.push({ payload, attempt: attempt + 1, retryAt: Date.now() + delayMs });
  }

  function flushReadyRetries() {
    const now = Date.now();
    let moved = 0;
    for (let i = retryQueue.length - 1; i >= 0; i--) {
      const entry = retryQueue[i];
      if (!entry || entry.retryAt > now) continue;
      retryQueue.splice(i, 1);

      // A newer edit may have synced successfully while this retry was waiting.
      // Re-applying the stale payload would overwrite that newer cloud state.
      const lastSynced = lastSyncedUpdatedAt.get(entry.payload.localPlanId);
      if (
        lastSynced !== undefined &&
        entry.payload.updatedAt !== undefined &&
        lastSynced >= entry.payload.updatedAt
      ) {
        continue;
      }

      pushToSyncQueue(entry.payload);
      retryAttemptByPlanId.set(entry.payload.localPlanId, entry.attempt);
      moved++;
    }
    if (moved > 0) processSyncQueue();
  }

  async function enqueueChangedPlans(plans: Plan[]): Promise<number> {
    if (plans.length === 0) return 0;
    refreshSyncCacheScope();
    const ipAddress = await getSyncIpAddress();
    const payloads = plans.map((plan) =>
      planToSyncPayload(plan, config.deviceId, hostname, ipAddress),
    );
    const needingSync = filterPayloadsNeedingSync(payloads, syncCache);
    if (needingSync.length === 0) return 0;
    pushToSyncQueue(...needingSync);
    processSyncQueue();
    return needingSync.length;
  }

  async function processSyncQueue() {
    if (syncing || syncQueue.length === 0) return;
    refreshSyncCacheScope();
    syncing = true;

    const batch = dedupeSyncPayloads(syncQueue.splice(0));
    let syncedCount = 0;
    let lowValueSkippedCount = 0;
    let lowValueDeletedCount = 0;
    let failedCount = 0;
    const failedPayloads: SyncPlanPayload[] = [];
    try {
      for (const payload of batch) {
        // Re-check freshness right before syncing: a newer edit for this plan
        // may have synced successfully after this (possibly stale, retried)
        // payload was queued but before its turn in this batch came up.
        const lastSynced = lastSyncedUpdatedAt.get(payload.localPlanId);
        if (
          lastSynced !== undefined &&
          payload.updatedAt !== undefined &&
          lastSynced >= payload.updatedAt
        ) {
          retryAttemptByPlanId.delete(payload.localPlanId);
          continue;
        }

        const requestScope = getDaemonCloudScope() ?? 'unconfigured';
        let result = await syncPlan(payload);

        if (!result.ok && result.error?.includes('401')) {
          const refreshed = await tryRefreshToken();
          if (refreshed) {
            result = await syncPlan(payload);
          }
        }

        const responseScope = getDaemonCloudScope() ?? 'unconfigured';
        if (responseScope !== requestScope) {
          refreshSyncCacheScope();
          pushToSyncQueue(payload);
          continue;
        }

        if (!result.ok) {
          if (result.error?.includes('401')) {
            console.error('[agendex] session expired. Run `agendex login` to re-authenticate.');
            syncQueue.length = 0;
            retryQueue.length = 0;
            break;
          }
          failedCount++;
          failedPayloads.push(payload);
          console.error(`[agendex] sync failed for "${payload.title}": ${result.error}`);
        } else {
          if (result.skippedLowValue) {
            lowValueSkippedCount++;
            if (result.deleted) lowValueDeletedCount++;
          } else {
            syncedCount++;
          }
          syncCache[payload.localPlanId] = computePayloadHash(payload);
          retryAttemptByPlanId.delete(payload.localPlanId);
          if (payload.updatedAt !== undefined) {
            lastSyncedUpdatedAt.set(payload.localPlanId, payload.updatedAt);
          }
        }
      }
    } catch (err) {
      console.error('[agendex] sync error:', err);
      pushToSyncQueue(...batch.slice(syncedCount + lowValueSkippedCount + failedCount));
    } finally {
      syncing = false;
    }

    for (const payload of failedPayloads) {
      const attempt = retryAttemptByPlanId.get(payload.localPlanId) ?? 0;
      retryAttemptByPlanId.delete(payload.localPlanId);
      scheduleSyncRetry(payload, attempt);
    }

    if (syncedCount > 0 || lowValueSkippedCount > 0 || failedCount > 0) {
      saveSyncCache(syncCache, { scope: syncCacheScope });
      const lowValueSuffix =
        lowValueSkippedCount > 0
          ? `, ${lowValueSkippedCount} low-value skipped/pruned${
              lowValueDeletedCount > 0 ? ` (${lowValueDeletedCount} deleted)` : ''
            }`
          : '';
      console.log(
        `[agendex] sync complete: ${syncedCount} synced${lowValueSuffix}, ${failedCount} failed`,
      );
    }
    if (syncQueue.length > 0) processSyncQueue();
  }

  /**
   * Reconcile the tracked set of live Plannotator sessions against the current
   * plan set. Newly-live sessions are remembered; sessions that have stopped
   * being live get an "ended" patch enqueued so the cloud copy reflects that the
   * loopback server is no longer reachable. Returns true if any patch was queued.
   */
  async function reconcileLivePlannotatorSessions(plans: Plan[]): Promise<boolean> {
    const ipAddress = await getSyncIpAddress();
    const livePayloads = new Map<string, SyncPlanPayload>();
    for (const plan of plans) {
      if (!isLivePlannotatorMetadata(plan.metadata)) continue;
      const payload = planToSyncPayload(plan, config.deviceId, hostname, ipAddress);
      livePayloads.set(payload.localPlanId, payload);
    }

    let queued = false;
    // Any previously-live session not present in the fresh live set has ended.
    for (const [planId, lastPayload] of liveSessions) {
      if (livePayloads.has(planId)) continue;
      const endedPayload = buildEndedPlannotatorPayload(lastPayload);
      pushToSyncQueue(endedPayload);
      liveSessions.delete(planId);
      queued = true;
      console.log(`[agendex] Plannotator session ended: ${endedPayload.title}`);
    }

    // Track the current live set (refresh remembered payloads).
    for (const [planId, payload] of livePayloads) {
      liveSessions.set(planId, payload);
    }

    if (queued) processSyncQueue();
    return queued;
  }

  function writebackScopeIsCurrent(expectedScope: string): boolean {
    return getDaemonCloudScope() === expectedScope;
  }

  function persistPendingWritebackReports(expectedScope: string): void {
    if (!writebackScopeIsCurrent(expectedScope)) return;
    if (!savePendingWritebackReports(pendingWritebackReports)) {
      console.error('[agendex] failed to persist Plannotator write-back delivery cache');
    }
  }

  async function reportPendingWriteback(writebackId: string, expectedScope: string): Promise<void> {
    if (!writebackScopeIsCurrent(expectedScope)) return;
    const status = pendingWritebackReports.get(writebackId);
    if (!status) return;

    const reported = await reportPlannotatorWriteback(
      writebackId,
      status,
      status === 'expired'
        ? PLANNOTATOR_WRITEBACK_EXPIRED_ERROR
        : status === 'failed'
          ? PLANNOTATOR_WRITEBACK_FAILED_ERROR
          : undefined,
    );
    if (!writebackScopeIsCurrent(expectedScope)) return;
    if (reported) {
      pendingWritebackReports.delete(writebackId);
      persistPendingWritebackReports(expectedScope);
    } else {
      console.error(
        '[agendex] failed to report write-back status for',
        writebackId,
        '- will retry',
      );
    }
  }

  async function handlePlannotatorWriteback(
    job: PlannotatorWritebackJob,
    expectedScope: string,
  ): Promise<void> {
    if (!writebackScopeIsCurrent(expectedScope)) return;
    if (pendingWritebackReports.has(job._id)) {
      await reportPendingWriteback(job._id, expectedScope);
      return;
    }

    if (job.expiresAt <= Date.now()) {
      pendingWritebackReports.set(job._id, 'expired');
      persistPendingWritebackReports(expectedScope);
      await reportPendingWriteback(job._id, expectedScope);
      return;
    }

    let localPlan = getById(job.localPlanId);
    if (!localPlan) {
      await scan();
      if (!writebackScopeIsCurrent(expectedScope)) return;
      localPlan = getById(job.localPlanId);
    }

    // Untargeted jobs may be visible to multiple daemons. If this machine does
    // not have the live session, leave the job pending so the correct daemon can
    // claim it before expiry. Targeted jobs should only reach their intended
    // daemon, so absence after a scan is actionable failure.
    if (!localPlan) {
      if (job.deviceId) {
        pendingWritebackReports.set(job._id, 'failed');
        persistPendingWritebackReports(expectedScope);
        await reportPendingWriteback(job._id, expectedScope);
      }
      return;
    }

    if (!writebackScopeIsCurrent(expectedScope)) return;
    const ok = await requestChanges(job.localPlanId, {
      action: job.action,
      feedback: job.feedback,
      revisedContent: job.revisedContent,
      annotations: job.annotations,
      source: job.source,
      writebackId: job._id,
      requestedAt: Date.now(),
    });
    if (!writebackScopeIsCurrent(expectedScope)) return;

    if (ok) {
      const updatedPlan = getById(job.localPlanId);
      if (updatedPlan) {
        const syncIpAddress = await getSyncIpAddress();
        if (!writebackScopeIsCurrent(expectedScope)) return;
        const updatedPayload = planToSyncPayload(
          updatedPlan,
          config.deviceId,
          hostname,
          syncIpAddress,
        );
        pushToSyncQueue(updatedPayload);
        if (isLivePlannotatorPayload(updatedPayload)) {
          liveSessions.set(updatedPayload.localPlanId, updatedPayload);
        }
      }
      pendingWritebackReports.set(job._id, 'sent');
      persistPendingWritebackReports(expectedScope);
      await reportPendingWriteback(job._id, expectedScope);
      if (!writebackScopeIsCurrent(expectedScope)) return;
      processSyncQueue();
      return;
    }

    pendingWritebackReports.set(job._id, 'failed');
    persistPendingWritebackReports(expectedScope);
    await reportPendingWriteback(job._id, expectedScope);
  }

  let pollingWritebacks = false;
  async function pollPlannotatorWritebacks(): Promise<void> {
    if (pollingWritebacks) return;
    pollingWritebacks = true;
    try {
      const writebackScope = getDaemonCloudScope();
      if (!writebackScope) return;
      const jobs = await fetchPlannotatorWritebacks();
      if (!writebackScopeIsCurrent(writebackScope)) return;
      for (const job of jobs) {
        if (!writebackScopeIsCurrent(writebackScope)) return;
        await handlePlannotatorWriteback(job, writebackScope);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AuthExpiredError') {
        console.error('[agendex] session expired. Run `agendex login` to re-authenticate.');
      } else {
        console.error('[agendex] Plannotator write-back polling failed:', err);
      }
    } finally {
      pollingWritebacks = false;
    }
  }

  let lastWatchPathKey = collectWatchPaths().join('\0');
  const onPlansFileChange = (changedPlans: unknown[]) => {
    void (async () => {
      await enqueueChangedPlans(changedPlans as Plan[]);
      await reconcileLivePlannotatorSessions(getAll());
    })().catch((err) => {
      console.error('[agendex] failed to queue changed plans:', err);
    });
  };

  options.registerCredentialUpdateHandler?.(() => {
    if (!refreshSyncCacheScope()) return;
    void enqueueChangedPlans(getAll()).catch((err) => {
      console.error('[agendex] failed to resync after cloud credentials changed:', err);
    });
  });

  let shuttingDown = false;
  async function gracefulShutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWatchingForShutdown();
    if (!skipRemoteShutdown) await withDeadline(sendShutdown(), REMOTE_SHUTDOWN_TIMEOUT_MS);
    process.exit(0);
  }

  // Installing signal handlers replaces the default terminate behaviour, so a
  // signal that arrives while the graceful path is still running has to exit on
  // its own. Otherwise the launcher's `kill()` looks like a no-op to it and it
  // gives up, leaving an orphaned worker behind.
  function terminate() {
    if (shuttingDown) process.exit(0);
    void gracefulShutdown();
  }

  activeShutdown = gracefulShutdown;
  process.on('SIGTERM', terminate);
  process.on('SIGINT', terminate);
  if (shutdownRequested) await gracefulShutdown();

  options.onStatus?.({ status: 'indexing', message: 'Scanning plan folders' });
  // Publish liveness before the first scan. WSL/UNC homes can take minutes to
  // traverse, and cloud clients should distinguish that healthy indexing phase
  // from a daemon that is actually offline.
  await sendHeartbeat(await getSyncIpAddress(true));

  console.log(`[agendex] initial scan...`);
  await scan();

  setOnPlansChanged((plans) => {
    void enqueueChangedPlans(plans as Plan[]).catch((err) => {
      console.error('[agendex] failed to sync plan store changes:', err);
    });
  });
  startWatching(onPlansFileChange);
  options.onReady?.();

  refreshSyncCacheScope();

  const plans = getAll();
  const syncablePlanCount = plans.filter(isIndexablePlan).length;
  const lowValuePlanCount = plans.length - syncablePlanCount;
  let initialSkipped = 0;
  let initialQueuedSyncable = 0;
  let initialQueuedLowValue = 0;

  const initialIpAddress = await getSyncIpAddress();
  for (const plan of plans) {
    const payload = planToSyncPayload(plan, config.deviceId, hostname, initialIpAddress);

    if (syncCache[plan.id] === computePayloadHash(payload)) {
      initialSkipped++;
      continue;
    }

    if (isLowValuePlan(plan)) {
      initialQueuedLowValue++;
    } else {
      initialQueuedSyncable++;
    }
    pushToSyncQueue(payload);
  }

  // Keep daemon cache bounded by removing plans no longer present locally.
  const activePlanIds = new Set(plans.map((plan) => plan.id));
  for (const id of Object.keys(syncCache)) {
    if (!activePlanIds.has(id)) delete syncCache[id];
  }
  saveSyncCache(syncCache, { scope: syncCacheScope, replace: true });

  const lowValueSuffix =
    lowValuePlanCount > 0 ? `, ${lowValuePlanCount} low-value hidden/pruned` : '';
  console.log(
    `[agendex] syncing ${initialQueuedSyncable} plans${lowValueSuffix} (${initialQueuedLowValue} low-value queued, ${initialSkipped} unchanged)...`,
  );
  await processSyncQueue();

  // Seed the live-session tracker from the initial scan so we can detect when any
  // of these sessions later stops being live.
  await reconcileLivePlannotatorSessions(getAll());

  const syncUsage = async () => {
    await syncUsageSnapshots(await getSyncIpAddress(true));
  };
  void syncUsage().catch((err) => {
    console.error('[agendex] failed to sync usage summary:', err);
  });

  setInterval(() => {
    void (async () => {
      await sendHeartbeat(await getSyncIpAddress(true));
    })().catch(() => {
      // Heartbeats are best-effort; the next interval will retry.
    });
  }, CLI_DAEMON_HEARTBEAT_INTERVAL_MS);

  setInterval(() => {
    void syncUsage().catch((err) => {
      console.error('[agendex] failed to sync usage summary:', err);
    });
  }, USAGE_SYNC_INTERVAL_MS);

  setInterval(() => {
    flushReadyRetries();
  }, RETRY_TICK_INTERVAL_MS);

  if (SYNC_RESCAN_INTERVAL_MS > 0) {
    setInterval(() => {
      void (async () => {
        await scan({ queueIfBusy: false });
        await enqueueChangedPlans(getAll());
        await reconcileLivePlannotatorSessions(getAll());
      })().catch((err) => {
        console.error('[agendex] safety rescan failed:', err);
      });
    }, SYNC_RESCAN_INTERVAL_MS);
  }

  if (WATCHER_REFRESH_INTERVAL_MS > 0) {
    setInterval(() => {
      const nextKey = collectWatchPaths().join('\0');
      if (nextKey === lastWatchPathKey) return;
      lastWatchPathKey = nextKey;
      console.log('[agendex] watch paths changed, refreshing file watchers...');
      startWatching(onPlansFileChange);
    }, WATCHER_REFRESH_INTERVAL_MS);
  }

  if (shouldEnablePlannotatorSync(config, cloudConfigured)) {
    setInterval(() => void pollPlannotatorWritebacks(), PLANNOTATOR_WRITEBACK_POLL_INTERVAL_MS);
    void pollPlannotatorWritebacks();

    // A Plannotator process dying does not touch the filesystem, so the watcher
    // never fires. Re-scan on an interval to prune dead sessions (parseLiveSession
    // drops them once the PID is gone) and publish their "ended" state.
    setInterval(() => {
      void (async () => {
        await scan({ queueIfBusy: false });
        await enqueueChangedPlans(getAll());
        await reconcileLivePlannotatorSessions(getAll());
      })().catch((err) => {
        console.error('[agendex] Plannotator liveness sweep failed:', err);
      });
    }, PLANNOTATOR_LIVENESS_SWEEP_INTERVAL_MS);

    if (LIVE_SESSION_POLL_MS > 0) {
      let pollingLiveSessions = false;
      setInterval(() => {
        if (pollingLiveSessions) return;
        pollingLiveSessions = true;
        void (async () => {
          if (!getAll().some((plan) => isLivePlannotatorMetadata(plan.metadata))) return;
          await scan({ queueIfBusy: false });
          const refreshedLive = getAll().filter((plan) => isLivePlannotatorMetadata(plan.metadata));
          await enqueueChangedPlans(refreshedLive);
        })()
          .catch((err) => {
            console.error('[agendex] live session poll failed:', err);
          })
          .finally(() => {
            pollingLiveSessions = false;
          });
      }, LIVE_SESSION_POLL_MS);
    }
  }

  console.log(`[agendex] daemon running. Watching for file changes...`);

  await new Promise(() => {});
}

export async function startSupervisor(): Promise<void> {
  let stopping = false;
  let workerProc: ChildProcess | null = null;
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveShutdownRequested: (() => void) | undefined;
  const shutdownRequested = new Promise<void>((resolve) => {
    resolveShutdownRequested = resolve;
  });

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    resolveShutdownRequested?.();
    console.log('[agendex] supervisor shutting down...');
    if (workerProc) {
      workerProc.kill('SIGTERM');
      forceKillTimer = setTimeout(
        () => workerProc?.kill('SIGKILL'),
        SUPERVISOR_WORKER_STOP_TIMEOUT_MS,
      );
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  clearDaemonStopRequest(process.pid);
  const stopRequestPoll = setInterval(() => {
    if (consumeDaemonStopRequest(process.pid)) shutdown();
  }, 100);
  stopRequestPoll.unref();

  const scriptPath = resolve(
    process.argv[1] ?? fileURLToPath(new URL('./cli.ts', import.meta.url)),
  );
  const restartTimes: number[] = [];

  while (!stopping) {
    const workerArgs = [scriptPath, 'start', '--worker'];
    if (isDevMode()) workerArgs.push('--dev');

    workerProc = spawn(process.execPath, workerArgs, {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
      env: {
        ...process.env,
        AGENDEX_DAEMON_SUPERVISOR_PID: String(process.pid),
        ...(isDevMode() ? { AGENDEX_DEV: '1' } : {}),
      },
    });
    const spawnedWorker = workerProc;
    let acceptReady = true;
    let resolveWorkerReady!: () => void;
    const workerReady = new Promise<void>((resolveReady) => {
      resolveWorkerReady = resolveReady;
    });
    if (spawnedWorker.pid) {
      writePid({ launcher: 'cli', workerPid: spawnedWorker.pid, ready: false });
    }
    spawnedWorker.on('message', (message) => {
      if (
        workerProc !== spawnedWorker ||
        !spawnedWorker.pid ||
        !message ||
        typeof message !== 'object' ||
        !('type' in message) ||
        message.type !== 'ready'
      ) {
        return;
      }
      if (!acceptReady) return;
      acceptReady = false;
      writePid({ launcher: 'cli', workerPid: spawnedWorker.pid, ready: true });
      resolveWorkerReady();
    });

    const workerExit = new Promise<number | null>((resolveExit) => {
      spawnedWorker.once('exit', (code) => resolveExit(code));
      spawnedWorker.once('error', (error) => {
        console.error('[agendex] failed to spawn worker:', error);
        resolveExit(1);
      });
    });
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const startupOutcome = await Promise.race([
      workerReady.then(() => 'ready' as const),
      workerExit.then(() => 'exit' as const),
      new Promise<'timeout'>((resolveTimeout) => {
        readyTimer = setTimeout(
          () => resolveTimeout('timeout'),
          SUPERVISOR_WORKER_READY_TIMEOUT_MS,
        );
      }),
    ]);
    if (readyTimer) clearTimeout(readyTimer);

    if (startupOutcome === 'timeout') {
      acceptReady = false;
      console.error('[agendex] worker timed out before reporting ready');
      spawnedWorker.kill('SIGTERM');
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      const stopped = await Promise.race([
        workerExit.then(() => true),
        new Promise<false>((resolveTimeout) => {
          stopTimer = setTimeout(() => resolveTimeout(false), SUPERVISOR_WORKER_STOP_TIMEOUT_MS);
        }),
      ]);
      if (stopTimer) clearTimeout(stopTimer);
      if (!stopped) spawnedWorker.kill('SIGKILL');
    }

    const exitCode = await workerExit;
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
      forceKillTimer = null;
    }
    workerProc = null;

    if (stopping) break;

    const now = Date.now();
    restartTimes.push(now);
    while (restartTimes.length > 0 && now - (restartTimes[0] as number) > RESTART_WINDOW_MS) {
      restartTimes.shift();
    }

    if (restartTimes.length > MAX_RESTARTS) {
      console.error(
        `[agendex] worker crashed ${MAX_RESTARTS} times in ${RESTART_WINDOW_MS / 1000}s, giving up`,
      );
      removePid(process.pid);
      clearDaemonStopRequest(process.pid);
      clearInterval(stopRequestPoll);
      process.exit(1);
    }

    console.log(
      `[agendex] worker exited (code ${exitCode}), restarting in ${RESTART_DELAY_MS / 1000}s...`,
    );
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      new Promise((resolveDelay) => {
        restartTimer = setTimeout(resolveDelay, RESTART_DELAY_MS);
      }),
      shutdownRequested,
    ]);
    if (restartTimer) clearTimeout(restartTimer);
  }

  if (forceKillTimer) clearTimeout(forceKillTimer);
  clearInterval(stopRequestPoll);
  clearDaemonStopRequest(process.pid);
  removePid(process.pid);
}
