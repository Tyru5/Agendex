import {
  getAll,
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
  setOnPlansChanged,
  startWatching,
} from '@agendex/shared';
import { type SyncPlanPayload, syncPlan } from './api.ts';

function planToPayload(plan: {
  id: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath: string;
  workspace?: string;
  metadata: Record<string, unknown>;
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
  };
}

export async function startDaemon(): Promise<void> {
  const config = await loadOrInitConfig();
  const adapters = resolveAdapters(config.enabledAdapters);
  setActiveAdapters(adapters);

  console.log(`[agendex] daemon starting with ${config.enabledAdapters.length} adapters`);

  const syncQueue: SyncPlanPayload[] = [];
  let syncing = false;

  async function processSyncQueue() {
    if (syncing || syncQueue.length === 0) return;
    syncing = true;

    const batch = syncQueue.splice(0);
    for (const payload of batch) {
      const result = await syncPlan(payload);
      if (!result.ok) {
        console.error(`[agendex] sync failed for "${payload.title}": ${result.error}`);
      }
    }

    syncing = false;
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
