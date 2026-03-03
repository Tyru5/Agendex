import {
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
import { type SyncPlanPayload, refreshToken, sendHeartbeat, syncPlan } from './api.ts';

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

export async function startDaemon(): Promise<void> {
  const config = await loadOrInitConfig();
  const adapters = resolveAdapters(config.enabledAdapters);
  setActiveAdapters(adapters);

  console.log(`[agendex] daemon starting with ${config.enabledAdapters.length} adapters`);

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
            process.exit(1);
          }
          console.error(`[agendex] sync failed for "${payload.title}": ${result.error}`);
        }
      }
    } catch (err) {
      console.error('[agendex] sync error:', err);
      syncQueue.unshift(...batch);
    } finally {
      syncing = false;
    }
    if (syncQueue.length > 0) processSyncQueue();
  }

  setOnPlansChanged(() => {
    // no-op: we handle sync via the watcher callback
  });

  console.log(`[agendex] initial scan...`);
  await scan();

  const plans = getAll();
  console.log(`[agendex] syncing ${plans.length} plans...`);

  for (const plan of plans) {
    syncQueue.push(planToPayload(plan));
  }
  await processSyncQueue();

  void sendHeartbeat();
  setInterval(() => void sendHeartbeat(), 30_000);

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
  console.log(`[agendex] Press Ctrl+C to stop.`);

  // keep process alive
  await new Promise(() => {});
}
