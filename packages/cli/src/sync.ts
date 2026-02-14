import {
  loadOrInitConfig,
  resolveAdapters,
  setActiveAdapters,
  scan,
  getAll,
} from '@agendex/shared';
import { syncPlan, type SyncPlanPayload } from './api.ts';

export async function syncAll(): Promise<void> {
  const config = await loadOrInitConfig();
  const adapters = resolveAdapters(config.enabledAdapters);
  setActiveAdapters(adapters);

  console.log(`[agendex] Scanning local plans...`);
  await scan();

  const plans = getAll();
  console.log(`[agendex] Found ${plans.length} plans. Syncing to cloud...`);

  let synced = 0;
  let failed = 0;

  for (const plan of plans) {
    const payload: SyncPlanPayload = {
      localPlanId: plan.id,
      agent: plan.agent,
      title: plan.title,
      content: plan.content,
      format: plan.format,
      filePath: plan.filePath,
      workspace: plan.workspace,
      metadata: plan.metadata,
    };

    const result = await syncPlan(payload);
    if (result.ok) {
      synced++;
    } else {
      failed++;
      console.error(`[agendex] Failed to sync "${plan.title}": ${result.error}`);
    }
  }

  console.log(`[agendex] Sync complete: ${synced} synced, ${failed} failed`);
}
