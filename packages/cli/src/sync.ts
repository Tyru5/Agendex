import {
  getAll,
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
} from '@agendex/shared';
import { type SyncPlanPayload, syncPlan } from './api.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';

export async function syncAll(force = false): Promise<void> {
  const config = await loadOrInitConfig();
  const adapters = resolveAdapters(config.enabledAdapters);
  setActiveAdapters(adapters);

  console.log(`[agendex] Scanning local plans...`);
  await scan();

  const plans = getAll();
  console.log(`[agendex] Found ${plans.length} plans. Syncing to cloud...`);

  const cache = force ? {} : loadSyncCache();
  const activePlanIds = new Set<string>();

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const plan of plans) {
    activePlanIds.add(plan.id);

    const payload: SyncPlanPayload = {
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

    const hash = computePayloadHash(payload);

    if (!force && cache[plan.id] === hash) {
      skipped++;
      continue;
    }

    const result = await syncPlan(payload);
    if (result.ok) {
      synced++;
      cache[plan.id] = hash;
    } else {
      failed++;
      console.error(`[agendex] Failed to sync "${plan.title}": ${result.error}`);
    }
  }

  // Prune cache entries for plans that no longer exist locally
  for (const id of Object.keys(cache)) {
    if (!activePlanIds.has(id)) delete cache[id];
  }

  saveSyncCache(cache);
  console.log(`[agendex] Sync complete: ${synced} synced, ${skipped} unchanged, ${failed} failed`);
}
