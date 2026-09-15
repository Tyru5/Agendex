import { hostname as osHostname } from 'node:os';
import {
  clearBytes,
  encryptPlanWrite,
  getAll,
  isIndexablePlan,
  isLowValuePlan,
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
} from '@agendex/shared';
import { serializeCryptoEnvelope } from '@agendex/shared/crypto';
import { resolveCliAdapterIds } from './adapters.ts';
import { fetchPlanCryptoIdentity, getDaemonCloudScope, syncPlan } from './api.ts';
import { getLocalIpAddress } from './network.ts';
import { planToSyncPayload } from './payload.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';
import { shouldIncludeLocalIpAddressInSync } from './sync-privacy.ts';
import { getCliWorkspaceCryptoContext, type CliWorkspaceCryptoContext } from './cloud-crypto.ts';

export async function syncAll(force = false): Promise<void> {
  const cryptoContext = await getCliWorkspaceCryptoContext({ promptIfMissing: true });
  try {
    await syncAllWithCrypto(force, cryptoContext);
  } finally {
    if (cryptoContext) clearBytes(cryptoContext.workspaceKey);
  }
}

async function syncAllWithCrypto(
  force: boolean,
  cryptoContext: CliWorkspaceCryptoContext | null,
): Promise<void> {
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

    const plainPayload = planToSyncPayload(plan, config.deviceId, hostname, ipAddress);

    const hash = computePayloadHash(plainPayload);

    if (!force && cache[plan.id] === hash) {
      skipped++;
      continue;
    }

    let payload = plainPayload;
    if (cryptoContext) {
      const encryptionArgs = {
        workspaceKey: cryptoContext.workspaceKey,
        workspaceOwnerId: cryptoContext.status.workspaceOwnerId,
        keyEpoch: cryptoContext.status.activeKeyEpoch,
        plan: {
          localPlanId: plainPayload.localPlanId,
          agent: plainPayload.agent,
          title: plainPayload.title,
          content: plainPayload.content,
          format: plainPayload.format,
          filePath: plainPayload.filePath,
          workspace: plainPayload.workspace,
          metadata: plainPayload.metadata,
          syncIdentity: plainPayload.syncIdentityKey,
          lowValue: isLowValuePlan(plan),
        },
      };
      let encrypted = encryptPlanWrite(encryptionArgs);
      const existingIdentity = await fetchPlanCryptoIdentity(encrypted.localPlanToken);
      if (!existingIdentity) {
        throw new Error('Unable to resolve encrypted plan identity; refusing to sync');
      }
      if (existingIdentity.found) {
        encrypted = encryptPlanWrite({
          ...encryptionArgs,
          stableCryptoId: existingIdentity.stableCryptoId,
        });
      }
      payload = {
        ...encrypted,
        encryptedSummary: serializeCryptoEnvelope(encrypted.encryptedSummary),
        encryptedBody: serializeCryptoEnvelope(encrypted.encryptedBody),
        encryptedVersionSummary: serializeCryptoEnvelope(encrypted.encryptedVersionSummary),
        encryptedVersionBody: serializeCryptoEnvelope(encrypted.encryptedVersionBody),
        createdAt: plainPayload.createdAt,
        updatedAt: plainPayload.updatedAt,
        identityVersion: plainPayload.identityVersion,
        identityStrength: plainPayload.identityStrength,
        cryptoProtocol: 1,
      };
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
      console.error(`[agendex] Failed to sync one plan: ${result.error}`);
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
