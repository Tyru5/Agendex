import { getUsageSummaries, type UsageSummary } from '@agendex/shared';
import { sendHeartbeat } from './api.ts';

export const USAGE_SYNC_INTERVAL_MS = 5 * 60_000;
export const CLOUD_USAGE_WINDOWS = [90, 30, 7, 1] as const;

export type CloudUsageSnapshots = Record<string, UsageSummary>;

type UsageSummariesLoader = (
  windows: readonly number[],
) => Promise<Readonly<Record<string, UsageSummary>>>;
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
    // Keep opaque fingerprints so cloud merge can skip overlapping scans.
    dedupeKeys: summary.dedupeKeys?.slice(0, 20_000),
  };
}

export async function collectUsageSnapshots(
  loadSummaries: UsageSummariesLoader = getUsageSummaries,
): Promise<CloudUsageSnapshots> {
  // One filesystem scan covers every cloud window; smaller windows filter the
  // shared record set instead of walking transcript dirs again.
  const raw = await loadSummaries(CLOUD_USAGE_WINDOWS);
  const snapshots: CloudUsageSnapshots = {};

  for (const days of CLOUD_USAGE_WINDOWS) {
    const summary = raw[String(days)];
    if (summary) snapshots[String(days)] = sanitizeUsageSummary(summary);
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
