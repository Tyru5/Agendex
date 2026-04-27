import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_DAEMON_HEARTBEAT_INTERVAL_MS,
  getAll,
  getById,
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
import { planToSyncPayload } from './payload.ts';
import { removePid, writePid } from './pid.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';
import {
  loadPendingWritebackReports,
  savePendingWritebackReports,
} from './writeback-delivery-cache.ts';

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 5_000;
const PLANNOTATOR_WRITEBACK_POLL_INTERVAL_MS = 15_000;
const PLANNOTATOR_WRITEBACK_EXPIRED_ERROR = 'Write-back expired before delivery.';

export async function runWorker(): Promise<void> {
  const config = await loadOrInitConfig();
  const adapterIds = resolveCliAdapterIds(config);
  const adapters = resolveAdapters(adapterIds);
  setActiveAdapters(adapters);

  console.log(`[agendex] daemon starting with ${adapterIds.length} adapters`);

  await sendHeartbeat();

  const syncCache = loadSyncCache();
  const syncQueue: SyncPlanPayload[] = [];
  const pendingWritebackReports = loadPendingWritebackReports();
  let syncing = false;

  async function tryRefreshToken(): Promise<boolean> {
    const cfg = loadConfig();
    if (!cfg?.cloudToken || !cfg.convexUrl) return false;

    const result = await refreshToken(cfg.cloudToken, cfg.convexUrl);
    if (!result) return false;

    saveConfig({ ...cfg, cloudToken: result.token });
    console.log('[agendex] cloud token refreshed');
    return true;
  }

  async function processSyncQueue() {
    if (syncing || syncQueue.length === 0) return;
    syncing = true;

    const batch = syncQueue.splice(0);
    let syncedCount = 0;
    let failedCount = 0;
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
            batch.length = 0;
            syncQueue.length = 0;
            break;
          }
          failedCount++;
          console.error(`[agendex] sync failed for "${payload.title}": ${result.error}`);
        } else {
          syncedCount++;
          syncCache[payload.localPlanId] = computePayloadHash(payload);
        }
      }
    } catch (err) {
      console.error('[agendex] sync error:', err);
      syncQueue.unshift(...batch.slice(syncedCount + failedCount));
    } finally {
      syncing = false;
    }
    if (syncedCount > 0 || failedCount > 0) {
      saveSyncCache(syncCache);
      console.log(`[agendex] sync complete: ${syncedCount} synced, ${failedCount} failed`);
    }
    if (syncQueue.length > 0) processSyncQueue();
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
      status === 'expired' ? PLANNOTATOR_WRITEBACK_EXPIRED_ERROR : undefined,
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
        await reportPlannotatorWriteback(
          job._id,
          'failed',
          'Target daemon could not find the live Plannotator session.',
        );
      }
      return;
    }

    const ok = await requestChanges(job.localPlanId, {
      feedback: job.feedback,
      revisedContent: job.revisedContent,
      annotations: job.annotations,
      source: job.source,
      writebackId: job._id,
      requestedAt: Date.now(),
    });

    if (ok) {
      const updatedPlan = getById(job.localPlanId);
      if (updatedPlan) syncQueue.push(planToSyncPayload(updatedPlan, config.deviceId));
      pendingWritebackReports.set(job._id, 'sent');
      persistPendingWritebackReports();
      await reportPendingWriteback(job._id);
      processSyncQueue();
      return;
    }

    await reportPlannotatorWriteback(
      job._id,
      'failed',
      'No live Plannotator session accepted the request-changes payload.',
    );
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

  setOnPlansChanged(() => {});

  console.log(`[agendex] initial scan...`);
  await scan();

  const plans = getAll();
  let initialSkipped = 0;

  for (const plan of plans) {
    const payload = planToSyncPayload(plan, config.deviceId);
    const hash = computePayloadHash(payload);

    if (syncCache[plan.id] === hash) {
      initialSkipped++;
      continue;
    }

    syncQueue.push(payload);
  }

  // Keep daemon cache bounded by removing plans no longer present locally.
  const activePlanIds = new Set(plans.map((plan) => plan.id));
  for (const id of Object.keys(syncCache)) {
    if (!activePlanIds.has(id)) delete syncCache[id];
  }
  saveSyncCache(syncCache, { replace: true });

  console.log(`[agendex] syncing ${syncQueue.length} plans (${initialSkipped} unchanged)...`);
  await processSyncQueue();

  setInterval(() => void sendHeartbeat(), CLI_DAEMON_HEARTBEAT_INTERVAL_MS);
  if (shouldEnablePlannotatorSync(config)) {
    setInterval(() => void pollPlannotatorWritebacks(), PLANNOTATOR_WRITEBACK_POLL_INTERVAL_MS);
    void pollPlannotatorWritebacks();
  }

  startWatching((changedPlans) => {
    for (const plan of changedPlans as Plan[]) {
      syncQueue.push(planToSyncPayload(plan, config.deviceId));
    }
    processSyncQueue();
  });

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
    workerProc = spawn(process.execPath, [scriptPath, 'start', '--worker'], {
      stdio: ['ignore', 'inherit', 'inherit'],
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
