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
  loadConfig,
  loadOrInitConfig,
  type Plan,
  requestChanges,
  resolveAdapters,
  saveConfig,
  scan,
  setActiveAdapters,
  setOnPlansChanged,
  startWatching,
  stopWatching,
} from '@agendex/shared';
import { resolveCliAdapterIds, shouldEnablePlannotatorSync } from './adapters.ts';
import {
  fetchPlannotatorWritebacks,
  type PlannotatorWritebackJob,
  refreshToken,
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
import { removePid, writePid } from './pid.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';
import { shouldIncludeLocalIpAddressInSync } from './sync-privacy.ts';
import {
  loadPendingWritebackReports,
  savePendingWritebackReports,
} from './writeback-delivery-cache.ts';

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 5_000;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * True when a sync payload represents a currently-live Plannotator session
 * (the only kind whose loopback URL is openable and that can accept write-backs).
 */
export function isLivePlannotatorPayload(payload: SyncPlanPayload): boolean {
  const plannotator = isRecord(payload.metadata) ? payload.metadata.plannotator : undefined;
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

export async function runWorker(): Promise<void> {
  const config = await loadOrInitConfig();
  const hostname = osHostname();
  const adapterIds = resolveCliAdapterIds(config);
  const adapters = resolveAdapters(adapterIds);
  setActiveAdapters(adapters);

  const syncCache = loadSyncCache();
  const syncQueue: SyncPlanPayload[] = [];
  const retryQueue: SyncRetryEntry[] = [];
  const retryAttemptByPlanId = new Map<string, number>();
  const pendingWritebackReports = loadPendingWritebackReports();
  // Last-synced payload for each plan id that is currently a live Plannotator
  // session. When such a plan stops being live (process died, session removed),
  // we synthesize an "ended" patch from the remembered payload so the cloud copy
  // stops advertising an open/write-back affordance. Keyed by localPlanId.
  const liveSessions = new Map<string, SyncPlanPayload>();
  let syncing = false;
  let cachedIpAddress: string | undefined;

  async function getSyncIpAddress(): Promise<string | undefined> {
    if (!(await shouldIncludeLocalIpAddressInSync())) {
      cachedIpAddress = undefined;
      return undefined;
    }

    cachedIpAddress ??= getLocalIpAddress();
    return cachedIpAddress;
  }

  console.log(`[agendex] daemon starting with ${adapterIds.length} adapters`);

  await sendHeartbeat(await getSyncIpAddress());

  async function tryRefreshToken(): Promise<boolean> {
    const cfg = loadConfig();
    if (!cfg?.cloudToken || !cfg.convexUrl) return false;

    const result = await refreshToken(cfg.cloudToken, cfg.convexUrl);
    if (!result) return false;

    saveConfig({ ...cfg, cloudToken: result.token });
    console.log('[agendex] cloud token refreshed');
    return true;
  }

  function pushToSyncQueue(...payloads: SyncPlanPayload[]) {
    for (const payload of payloads) {
      const idx = syncQueue.findIndex((p) => p.localPlanId === payload.localPlanId);
      if (idx >= 0) syncQueue[idx] = payload;
      else syncQueue.push(payload);
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
      pushToSyncQueue(entry.payload);
      retryAttemptByPlanId.set(entry.payload.localPlanId, entry.attempt);
      moved++;
    }
    if (moved > 0) processSyncQueue();
  }

  async function enqueueChangedPlans(plans: Plan[]): Promise<number> {
    if (plans.length === 0) return 0;
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
    syncing = true;

    const batch = dedupeSyncPayloads(syncQueue.splice(0));
    let syncedCount = 0;
    let lowValueSkippedCount = 0;
    let lowValueDeletedCount = 0;
    let failedCount = 0;
    const failedPayloads: SyncPlanPayload[] = [];
    try {
      for (const payload of batch) {
        let result = await syncPlan(payload);

        if (!result.ok && result.error?.includes('401')) {
          const refreshed = await tryRefreshToken();
          if (refreshed) {
            result = await syncPlan(payload);
          }
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
      saveSyncCache(syncCache);
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
      const payload = planToSyncPayload(plan, config.deviceId, hostname, ipAddress);
      if (isLivePlannotatorPayload(payload)) livePayloads.set(payload.localPlanId, payload);
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

  function persistPendingWritebackReports(): void {
    if (!savePendingWritebackReports(pendingWritebackReports)) {
      console.error('[agendex] failed to persist Plannotator write-back delivery cache');
    }
  }

  async function reportPendingWriteback(writebackId: string): Promise<void> {
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
    if (reported) {
      pendingWritebackReports.delete(writebackId);
      persistPendingWritebackReports();
    } else {
      console.error(
        '[agendex] failed to report write-back status for',
        writebackId,
        '- will retry',
      );
    }
  }

  async function handlePlannotatorWriteback(job: PlannotatorWritebackJob): Promise<void> {
    if (pendingWritebackReports.has(job._id)) {
      await reportPendingWriteback(job._id);
      return;
    }

    if (job.expiresAt <= Date.now()) {
      pendingWritebackReports.set(job._id, 'expired');
      persistPendingWritebackReports();
      await reportPendingWriteback(job._id);
      return;
    }

    let localPlan = getById(job.localPlanId);
    if (!localPlan) {
      await scan();
      localPlan = getById(job.localPlanId);
    }

    // Untargeted jobs may be visible to multiple daemons. If this machine does
    // not have the live session, leave the job pending so the correct daemon can
    // claim it before expiry. Targeted jobs should only reach their intended
    // daemon, so absence after a scan is actionable failure.
    if (!localPlan) {
      if (job.deviceId) {
        pendingWritebackReports.set(job._id, 'failed');
        persistPendingWritebackReports();
        await reportPendingWriteback(job._id);
      }
      return;
    }

    const ok = await requestChanges(job.localPlanId, {
      action: job.action,
      feedback: job.feedback,
      revisedContent: job.revisedContent,
      annotations: job.annotations,
      source: job.source,
      writebackId: job._id,
      requestedAt: Date.now(),
    });

    if (ok) {
      const updatedPlan = getById(job.localPlanId);
      if (updatedPlan) {
        const updatedPayload = planToSyncPayload(
          updatedPlan,
          config.deviceId,
          hostname,
          await getSyncIpAddress(),
        );
        pushToSyncQueue(updatedPayload);
        if (isLivePlannotatorPayload(updatedPayload)) {
          liveSessions.set(updatedPayload.localPlanId, updatedPayload);
        }
      }
      pendingWritebackReports.set(job._id, 'sent');
      persistPendingWritebackReports();
      await reportPendingWriteback(job._id);
      processSyncQueue();
      return;
    }

    pendingWritebackReports.set(job._id, 'failed');
    persistPendingWritebackReports();
    await reportPendingWriteback(job._id);
  }

  let pollingWritebacks = false;
  async function pollPlannotatorWritebacks(): Promise<void> {
    if (pollingWritebacks) return;
    pollingWritebacks = true;
    try {
      const jobs = await fetchPlannotatorWritebacks();
      for (const job of jobs) {
        await handlePlannotatorWriteback(job);
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

  console.log(`[agendex] initial scan...`);
  await scan();

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
  saveSyncCache(syncCache, { replace: true });

  const lowValueSuffix =
    lowValuePlanCount > 0 ? `, ${lowValuePlanCount} low-value hidden/pruned` : '';
  console.log(
    `[agendex] syncing ${initialQueuedSyncable} plans${lowValueSuffix} (${initialQueuedLowValue} low-value queued, ${initialSkipped} unchanged)...`,
  );
  await processSyncQueue();

  // Seed the live-session tracker from the initial scan so we can detect when any
  // of these sessions later stops being live.
  await reconcileLivePlannotatorSessions(getAll());

  setOnPlansChanged((plans) => {
    void enqueueChangedPlans(plans as Plan[]).catch((err) => {
      console.error('[agendex] failed to sync plan store changes:', err);
    });
  });

  setInterval(() => {
    void (async () => {
      await sendHeartbeat(await getSyncIpAddress());
    })().catch(() => {
      // Heartbeats are best-effort; the next interval will retry.
    });
  }, CLI_DAEMON_HEARTBEAT_INTERVAL_MS);

  setInterval(() => {
    flushReadyRetries();
  }, RETRY_TICK_INTERVAL_MS);

  if (SYNC_RESCAN_INTERVAL_MS > 0) {
    setInterval(() => {
      void (async () => {
        await scan();
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

  if (shouldEnablePlannotatorSync(config)) {
    setInterval(() => void pollPlannotatorWritebacks(), PLANNOTATOR_WRITEBACK_POLL_INTERVAL_MS);
    void pollPlannotatorWritebacks();

    // A Plannotator process dying does not touch the filesystem, so the watcher
    // never fires. Re-scan on an interval to prune dead sessions (parseLiveSession
    // drops them once the PID is gone) and publish their "ended" state.
    setInterval(() => {
      void (async () => {
        await scan();
        await enqueueChangedPlans(getAll());
        await reconcileLivePlannotatorSessions(getAll());
      })().catch((err) => {
        console.error('[agendex] Plannotator liveness sweep failed:', err);
      });
    }, PLANNOTATOR_LIVENESS_SWEEP_INTERVAL_MS);

    if (LIVE_SESSION_POLL_MS > 0) {
      setInterval(() => {
        void (async () => {
          const ipAddress = await getSyncIpAddress();
          const livePlans = getAll().filter((plan) => {
            const payload = planToSyncPayload(plan, config.deviceId, hostname, ipAddress);
            return isLivePlannotatorPayload(payload);
          });
          if (livePlans.length === 0) return;
          await scan();
          const refreshedLive = getAll().filter((plan) => {
            const payload = planToSyncPayload(plan, config.deviceId, hostname, ipAddress);
            return isLivePlannotatorPayload(payload);
          });
          await enqueueChangedPlans(refreshedLive);
        })().catch((err) => {
          console.error('[agendex] live session poll failed:', err);
        });
      }, LIVE_SESSION_POLL_MS);
    }
  }

  startWatching(onPlansFileChange);

  console.log(`[agendex] daemon running. Watching for file changes...`);

  async function gracefulShutdown() {
    stopWatching();
    await sendShutdown();
    process.exit(0);
  }
  process.on('SIGTERM', () => void gracefulShutdown());
  process.on('SIGINT', () => void gracefulShutdown());

  await new Promise(() => {});
}

export async function startSupervisor(): Promise<void> {
  writePid();

  let stopping = false;
  let workerProc: ChildProcess | null = null;

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('[agendex] supervisor shutting down...');
    if (workerProc) workerProc.kill('SIGTERM');
    removePid();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const scriptPath = resolve(
    process.argv[1] ?? fileURLToPath(new URL('./cli.ts', import.meta.url)),
  );
  const restartTimes: number[] = [];

  while (!stopping) {
    const workerArgs = [scriptPath, 'start', '--worker'];
    if (isDevMode()) workerArgs.push('--dev');

    workerProc = spawn(process.execPath, workerArgs, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, ...(isDevMode() ? { AGENDEX_DEV: '1' } : {}) },
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      workerProc?.once('exit', (code) => resolve(code));
      workerProc?.once('error', (error) => {
        console.error('[agendex] failed to spawn worker:', error);
        resolve(1);
      });
    });
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
      removePid();
      process.exit(1);
    }

    console.log(
      `[agendex] worker exited (code ${exitCode}), restarting in ${RESTART_DELAY_MS / 1000}s...`,
    );
    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
  }

  removePid();
}
