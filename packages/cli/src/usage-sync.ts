import { getUsageSummaries, type UsageSummary } from '@agendex/shared';
import { hasDaemonCloudCredentials, sendHeartbeat } from './api.ts';

export const USAGE_SYNC_INTERVAL_MS = 5 * 60_000;
export const CLOUD_USAGE_WINDOWS = [90, 30, 7, 1] as const;
const MAX_CLOUD_DEDUPE_KEYS = 8_192;
const MAX_CLOUD_USAGE_BYTES = 450_000;
const DEDUPE_KEY_REDUCTION_STEPS = [5_000, 2_000, 1_000, 500, 250, 100] as const;
const PARTIAL_EVENT_REDUCTION_STEPS = [200, 100, 50, 25, 10, 1] as const;
const CLOUD_USAGE_FORMAT_VERSION = 2 as const;
export type CloudUsageSummary = UsageSummary & {
  cloudFormatVersion: typeof CLOUD_USAGE_FORMAT_VERSION;
};
export type CloudUsageSnapshots = Record<string, CloudUsageSummary>;

type UsageSummariesLoader = (
  windows: readonly number[],
) => Promise<Readonly<Record<string, UsageSummary>>>;
type UsageSnapshotLoader = () => Promise<CloudUsageSnapshots>;
type HeartbeatSender = (
  ipAddress?: string,
  usageSnapshots?: Readonly<Record<string, UsageSummary>>,
) => Promise<void>;
type CloudConfigured = () => boolean;

export function sanitizeUsageSummary(summary: UsageSummary): CloudUsageSummary {
  const { events: _events, ...summaryWithoutEvents } = summary;
  const events = summary.events?.length ? summary.events : undefined;

  return {
    ...summaryWithoutEvents,
    // Local transcript paths and scanner diagnostics never leave the device.
    cloudFormatVersion: CLOUD_USAGE_FORMAT_VERSION,
    sources: [],
    scanDurationMs: 0,
    // Partial events remain for older independently deployed backends. Current
    // backends prefer complete ownership keys when both representations exist.
    // Sort opaque keys before fitting so every device retains the same bounded
    // sample regardless of local transcript scan order.
    dedupeKeys: summary.dedupeKeys
      ? [...summary.dedupeKeys].sort().slice(0, MAX_CLOUD_DEDUPE_KEYS)
      : undefined,
    ...(events ? { events } : {}),
  };
}

function usageSnapshotsByteLength(snapshots: CloudUsageSnapshots): number {
  return Buffer.byteLength(JSON.stringify(snapshots));
}

function hasExactEvents(snapshot: UsageSummary): boolean {
  return Boolean(snapshot.events?.length && snapshot.events.length === snapshot.records);
}

function reduceDedupeKeysToFit(
  snapshots: CloudUsageSnapshots,
  shouldReduce: (snapshot: UsageSummary) => boolean,
): boolean {
  for (const limit of DEDUPE_KEY_REDUCTION_STEPS) {
    let reducedKeys = false;
    for (const snapshot of Object.values(snapshots)) {
      if (shouldReduce(snapshot) && snapshot.dedupeKeys && snapshot.dedupeKeys.length > limit) {
        snapshot.dedupeKeys = snapshot.dedupeKeys.slice(0, limit);
        reducedKeys = true;
      }
    }
    if (reducedKeys && usageSnapshotsByteLength(snapshots) <= MAX_CLOUD_USAGE_BYTES) {
      return true;
    }
  }
  return false;
}
function reducePartialEventsToFit(snapshots: CloudUsageSnapshots): boolean {
  for (const limit of PARTIAL_EVENT_REDUCTION_STEPS) {
    let reducedEvents = false;
    for (const snapshot of Object.values(snapshots)) {
      if (snapshot.events && !hasExactEvents(snapshot) && snapshot.events.length > limit) {
        snapshot.events = snapshot.events.slice(0, limit);
        reducedEvents = true;
      }
    }
    if (reducedEvents && usageSnapshotsByteLength(snapshots) <= MAX_CLOUD_USAGE_BYTES) {
      return true;
    }
  }
  return false;
}

function fitUsageSnapshotsToBudget(snapshots: CloudUsageSnapshots): CloudUsageSnapshots {
  if (usageSnapshotsByteLength(snapshots) <= MAX_CLOUD_USAGE_BYTES) return snapshots;

  const exactEventKeys = new Map<string, string[]>();
  for (const [window, snapshot] of Object.entries(snapshots)) {
    if (hasExactEvents(snapshot) && snapshot.dedupeKeys) {
      exactEventKeys.set(window, snapshot.dedupeKeys);
      delete snapshot.dedupeKeys;
    }
  }
  if (exactEventKeys.size > 0 && usageSnapshotsByteLength(snapshots) <= MAX_CLOUD_USAGE_BYTES) {
    return snapshots;
  }
  if (reduceDedupeKeysToFit(snapshots, (snapshot) => !hasExactEvents(snapshot))) {
    return snapshots;
  }
  if (reducePartialEventsToFit(snapshots)) return snapshots;

  let removedPartialEvents = false;
  for (const snapshot of Object.values(snapshots)) {
    if (snapshot.events && !hasExactEvents(snapshot)) {
      delete snapshot.events;
      removedPartialEvents = true;
    }
  }
  if (removedPartialEvents && usageSnapshotsByteLength(snapshots) <= MAX_CLOUD_USAGE_BYTES) {
    return snapshots;
  }

  for (const [window, keys] of exactEventKeys) {
    const snapshot = snapshots[window];
    if (snapshot) snapshot.dedupeKeys = keys;
  }
  let removedExactEvents = false;
  for (const snapshot of Object.values(snapshots)) {
    if (hasExactEvents(snapshot) && snapshot.dedupeKeys?.length) {
      delete snapshot.events;
      removedExactEvents = true;
    }
  }
  if (removedExactEvents && usageSnapshotsByteLength(snapshots) <= MAX_CLOUD_USAGE_BYTES) {
    return snapshots;
  }

  if (reduceDedupeKeysToFit(snapshots, () => true)) return snapshots;

  throw new Error('Usage summaries exceed the cloud heartbeat byte budget');
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

  return fitUsageSnapshotsToBudget(snapshots);
}

export function createUsageSync(
  loadSnapshots: UsageSnapshotLoader = collectUsageSnapshots,
  heartbeat: HeartbeatSender = sendHeartbeat,
  cloudConfigured: CloudConfigured = hasDaemonCloudCredentials,
): (ipAddress?: string) => Promise<void> {
  let syncInFlight: Promise<void> | null = null;

  return (ipAddress?: string) => {
    if (!cloudConfigured()) return Promise.resolve();
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
