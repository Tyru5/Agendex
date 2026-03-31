import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_DAEMON_HEARTBEAT_INTERVAL_MS,
  getAll,
  loadConfig,
  loadOrInitConfig,
  resolveAdapters,
  saveConfig,
  scan,
  setActiveAdapters,
  setOnPlansChanged,
  startWatching,
} from '@agendex/shared';
import { refreshToken, type SyncPlanPayload, sendHeartbeat, syncPlan } from './api.ts';
import { removePid, writePid } from './pid.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 5_000;

function planToPayload(plan: {
  id: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath: string;
  workspace?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}): SyncPlanPayload {
  return {
    localPlanId: plan.id,
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    filePath: plan.filePath,
    workspace: plan.workspace,
    metadata: plan.metadata,
    createdAt: plan.createdAt.getTime(),
    updatedAt: plan.updatedAt.getTime(),
  };
}

export async function runWorker(): Promise<void> {
  const config = await loadOrInitConfig();
  const adapters = resolveAdapters(config.enabledAdapters);
  setActiveAdapters(adapters);

  console.log(`[agendex] daemon starting with ${config.enabledAdapters.length} adapters`);

  void sendHeartbeat();

  const syncCache = loadSyncCache();
  const syncQueue: SyncPlanPayload[] = [];
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

  setOnPlansChanged(() => {});

  console.log(`[agendex] initial scan...`);
  await scan();

  const plans = getAll();
  let initialSkipped = 0;

  for (const plan of plans) {
    const payload = planToPayload(plan);
    const hash = computePayloadHash(payload);

    if (syncCache[plan.id] === hash) {
      initialSkipped++;
      continue;
    }

    syncQueue.push(payload);
  }

  console.log(`[agendex] syncing ${syncQueue.length} plans (${initialSkipped} unchanged)...`);
  await processSyncQueue();

  setInterval(() => void sendHeartbeat(), CLI_DAEMON_HEARTBEAT_INTERVAL_MS);

  startWatching((changedPlans) => {
    for (const plan of changedPlans as Array<{
      id: string;
      agent: string;
      title: string;
      content: string;
      format: string;
      filePath: string;
      workspace?: string;
      metadata: Record<string, unknown>;
      createdAt: Date;
      updatedAt: Date;
    }>) {
      syncQueue.push(planToPayload(plan));
    }
    processSyncQueue();
  });

  console.log(`[agendex] daemon running. Watching for file changes...`);

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
