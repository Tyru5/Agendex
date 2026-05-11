import type { Plan } from './api.ts';

export interface PlanSyncOrigin {
  hostname?: string;
  deviceId?: string;
  ipAddress?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads `metadata.agendexSync` from a plan and returns the device/machine
 * provenance recorded by the CLI/daemon at sync time. Returns `null` when no
 * sync metadata is present (e.g. local-only OSS plans).
 */
export function extractSyncOrigin(plan: Pick<Plan, 'metadata'>): PlanSyncOrigin | null {
  if (!isRecord(plan.metadata)) return null;
  const sync = plan.metadata.agendexSync;
  if (!isRecord(sync)) return null;

  const hostname =
    typeof sync.hostname === 'string' && sync.hostname.trim() ? sync.hostname.trim() : undefined;
  const deviceId =
    typeof sync.deviceId === 'string' && sync.deviceId.trim() ? sync.deviceId.trim() : undefined;
  const ipAddress =
    typeof sync.ipAddress === 'string' && sync.ipAddress.trim() ? sync.ipAddress.trim() : undefined;

  if (!hostname && !deviceId && !ipAddress) return null;
  return { hostname, deviceId, ipAddress };
}

/**
 * Renders the machine provenance as a single human-readable string.
 * Used wherever the UI needs to show *which machine* synced a plan.
 */
export function formatSyncOriginLabel(origin: PlanSyncOrigin): string {
  const name = origin.hostname ?? 'unknown machine';
  return origin.ipAddress ? `${name} (${origin.ipAddress})` : name;
}
