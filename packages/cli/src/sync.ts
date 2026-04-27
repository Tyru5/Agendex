import {
  getAll,
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
} from '@agendex/shared';
import { resolveCliAdapterIds } from './adapters.ts';
import { syncPlan } from './api.ts';
import { planToSyncPayload } from './payload.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';

export async function syncAll(force = false): Promise<void> {
  const config = await loadOrInitConfig();
  const adapterIds = resolveCliAdapterIds(config);
  const adapters = resolveAdapters(adapterIds);
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

    const payload = planToSyncPayload(plan, config.deviceId);

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

  // Use replace mode so prune deletions and force-run failures are reflected on disk.
  saveSyncCache(cache, { replace: true });
  console.log(`[agendex] Sync complete: ${synced} synced, ${skipped} unchanged, ${failed} failed`);
}
