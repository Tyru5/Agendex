import {
  getAll,
  isIndexablePlan,
  isLowValuePlan,
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
} from '@agendex/shared';
import { type SyncPlanPayload, syncPlan } from './api.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';

function planToPayload(plan: ReturnType<typeof getAll>[number]): SyncPlanPayload {
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

export async function syncAll(force = false): Promise<void> {
  const config = await loadOrInitConfig();
  const adapters = resolveAdapters(config.enabledAdapters);
  setActiveAdapters(adapters);

  console.log(`[agendex] Scanning local plans...`);
  await scan();

  const allPlans = getAll();
  const syncablePlans = allPlans.filter(isIndexablePlan);
  const lowValuePlans = allPlans.filter(isLowValuePlan);
  const hiddenSuffix =
    lowValuePlans.length > 0 ? ` (${lowValuePlans.length} low-value hidden/pruned)` : '';
  console.log(
    `[agendex] Found ${syncablePlans.length} syncable plans${hiddenSuffix}. Syncing to cloud...`,
  );

  const cache = force ? {} : loadSyncCache();
  const activePlanIds = new Set<string>();

  let synced = 0;
  let lowValueSkipped = 0;
  let lowValueDeleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const plan of [...syncablePlans, ...lowValuePlans]) {
    activePlanIds.add(plan.id);

    const payload = planToPayload(plan);
    const hash = computePayloadHash(payload);

    if (!force && cache[plan.id] === hash) {
      skipped++;
      continue;
    }

    const result = await syncPlan(payload);
    if (result.ok) {
      if (result.skippedLowValue) {
        lowValueSkipped++;
        if (result.deleted) lowValueDeleted++;
      } else {
        synced++;
      }
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

  // Use replace mode so prune deletions and force-run failures are reflected on disk.
  saveSyncCache(cache, { replace: true });
  const lowValueSuffix =
    lowValueSkipped > 0
      ? `, ${lowValueSkipped} low-value skipped/pruned${
          lowValueDeleted > 0 ? ` (${lowValueDeleted} deleted)` : ''
        }`
      : '';
  console.log(
    `[agendex] Sync complete: ${synced} synced${lowValueSuffix}, ${skipped} unchanged, ${failed} failed`,
  );
}
