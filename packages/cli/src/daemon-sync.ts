import type { SyncPlanPayload } from './api.ts';
import { computePayloadHash } from './sync-cache.ts';

export const DEFAULT_LIVE_SESSION_POLL_MS = 2_000;
export const DEFAULT_SYNC_RESCAN_INTERVAL_MS = 60_000;
export const DEFAULT_WATCHER_REFRESH_INTERVAL_MS = 300_000;
export const SYNC_RETRY_DELAYS_MS = [2_000, 8_000, 30_000] as const;
export const SYNC_MAX_RETRIES = SYNC_RETRY_DELAYS_MS.length;

export function parseEnvMs(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultMs;
  return parsed;
}

/**
 * Build order for sync payloads. Metadata-only changes, such as restoring a hidden
 * plan, keep the source updatedAt, so equal timestamps fall back to build order.
 */
export function createSyncPayloadOrder() {
  let next = 0;
  const sequences = new WeakMap<SyncPlanPayload, number>();
  const sequenceOf = (payload: SyncPlanPayload): number => {
    let sequence = sequences.get(payload);
    if (sequence === undefined) {
      sequence = ++next;
      sequences.set(payload, sequence);
    }
    return sequence;
  };
  return {
    sequenceOf,
    /** True when `payload` is not newer than `reference` (an already queued or synced payload). */
    isSuperseded(
      payload: SyncPlanPayload,
      reference: { updatedAt?: number; sequence: number } | undefined,
    ): boolean {
      if (!reference || payload.updatedAt === undefined || reference.updatedAt === undefined)
        return false;
      if (reference.updatedAt !== payload.updatedAt) return reference.updatedAt > payload.updatedAt;
      return reference.sequence >= sequenceOf(payload);
    },
  };
}

/** Keep the latest payload per localPlanId (last write wins). */
export function dedupeSyncPayloads(payloads: SyncPlanPayload[]): SyncPlanPayload[] {
  const byId = new Map<string, SyncPlanPayload>();
  for (const payload of payloads) {
    byId.set(payload.localPlanId, payload);
  }
  return [...byId.values()];
}

export function payloadNeedsSync(payload: SyncPlanPayload, cache: Record<string, string>): boolean {
  return cache[payload.localPlanId] !== computePayloadHash(payload);
}

export function filterPayloadsNeedingSync(
  payloads: SyncPlanPayload[],
  cache: Record<string, string>,
): SyncPlanPayload[] {
  return payloads.filter((payload) => payloadNeedsSync(payload, cache));
}

export interface SyncRetryEntry {
  payload: SyncPlanPayload;
  attempt: number;
  retryAt: number;
}

export function nextRetryDelayMs(attempt: number): number | undefined {
  return SYNC_RETRY_DELAYS_MS[attempt];
}
