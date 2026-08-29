import { getUsageSummary, type UsageSummary } from '@agendex/shared';
import { sendHeartbeat } from './api.ts';

export const USAGE_SYNC_INTERVAL_MS = 5 * 60_000;
export const CLOUD_USAGE_WINDOWS = [90, 30, 7, 1] as const;

export type CloudUsageSnapshots = Record<string, UsageSummary>;

type UsageSummaryLoader = (options: { days: number }) => Promise<UsageSummary>;
type UsageSnapshotLoader = () => Promise<CloudUsageSnapshots>;
type HeartbeatSender = (
  ipAddress?: string,
  usageSnapshots?: Readonly<Record<string, UsageSummary>>,
) => Promise<void>;

export function sanitizeUsageSummary(summary: UsageSummary): UsageSummary {
  return {
    ...summary,
    // Local transcript paths and scanner diagnostics never leave the device.
    sources: [],
    scanDurationMs: 0,
  };
}

export async function collectUsageSnapshots(
  loadSummary: UsageSummaryLoader = getUsageSummary,
): Promise<CloudUsageSnapshots> {
  const snapshots: CloudUsageSnapshots = {};

  // Scan the largest window first. Later windows reuse the per-file scan cache.
  for (const days of CLOUD_USAGE_WINDOWS) {
    snapshots[String(days)] = sanitizeUsageSummary(await loadSummary({ days }));
  }

  return snapshots;
}

export function createUsageSync(
  loadSnapshots: UsageSnapshotLoader = collectUsageSnapshots,
  heartbeat: HeartbeatSender = sendHeartbeat,
): (ipAddress?: string) => Promise<void> {
  let syncInFlight: Promise<void> | null = null;

  return (ipAddress?: string) => {
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
      const snapshots = await loadSnapshots();
      await heartbeat(ipAddress, snapshots);
    })().finally(() => {
      syncInFlight = null;
    });

    return syncInFlight;
  };
}

export const syncUsageSnapshots = createUsageSync();
