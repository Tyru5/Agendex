import { hostname as osHostname } from 'node:os';
import {
  getAll,
  isIndexablePlan,
  isLowValuePlan,
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
} from '@agendex/shared';
import { resolveCliAdapterIds } from './adapters.ts';
import { getDaemonCloudScope, syncPlan } from './api.ts';
import { getLocalIpAddress } from './network.ts';
import { planToSyncPayload } from './payload.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';
import { shouldIncludeLocalIpAddressInSync } from './sync-privacy.ts';

export async function syncAll(force = false): Promise<void> {
  const config = await loadOrInitConfig();
  const hostname = osHostname();
  const ipAddress = (await shouldIncludeLocalIpAddressInSync()) ? getLocalIpAddress() : undefined;
  const adapterIds = resolveCliAdapterIds(config);
  const adapters = resolveAdapters(adapterIds);
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

  const syncCacheScope = getDaemonCloudScope() ?? 'unconfigured';
  const cache = force ? {} : loadSyncCache(syncCacheScope);
  const activePlanIds = new Set<string>();

  let synced = 0;
  let lowValueSkipped = 0;
  let lowValueDeleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const plan of [...syncablePlans, ...lowValuePlans]) {
    if ((getDaemonCloudScope() ?? 'unconfigured') !== syncCacheScope) {
      throw new Error('Cloud credentials changed during sync. Run `agendex sync` again.');
    }
    activePlanIds.add(plan.id);

    const payload = planToSyncPayload(plan, config.deviceId, hostname, ipAddress);

    const hash = computePayloadHash(payload);

    if (!force && cache[plan.id] === hash) {
      skipped++;
      continue;
    }

    const result = await syncPlan(payload);
    if ((getDaemonCloudScope() ?? 'unconfigured') !== syncCacheScope) {
      throw new Error('Cloud credentials changed during sync. Run `agendex sync` again.');
    }
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
  saveSyncCache(cache, { scope: syncCacheScope, replace: true });
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
