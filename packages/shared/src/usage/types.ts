/**
 * Token/cost usage shapes shared between the transcript scanner, the OSS API
 * route, and the web client.
 *
 * Token categories are disjoint so they can be summed safely:
 * - `uncachedInputTokens` excludes cached reads and cache creation.
 * - `reasoningTokens` is informational only — it is already counted inside
 *   `outputTokens` and must NOT be added to totals.
 */
export interface UsageTokenTotals {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** Processed tokens = disjoint categories summed; reasoning is inside output. */
export function totalTokens(t: UsageTokenTotals): number {
  return t.uncachedInputTokens + t.cachedInputTokens + t.cacheCreationTokens + t.outputTokens;
}

export function emptyTokenTotals(): UsageTokenTotals {
  return {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

export function addTokenTotals(into: UsageTokenTotals, from: UsageTokenTotals): void {
  into.uncachedInputTokens += from.uncachedInputTokens;
  into.cachedInputTokens += from.cachedInputTokens;
  into.cacheCreationTokens += from.cacheCreationTokens;
  into.outputTokens += from.outputTokens;
  into.reasoningTokens += from.reasoningTokens;
}

/** Agent ids match the adapter ids so the client can reuse icons/labels. */
export type UsageAgent = 'claude-code' | 'codex-cli' | 'grok';

/** One normalized usage event extracted from a provider transcript line. */
export interface UsageRecord {
  agent: UsageAgent;
  timestampMs: number;
  model: string;
  sessionId: string;
  totals: UsageTokenTotals;
  /** Cost reported by the provider transcript itself, when present. */
  reportedCostUsd: number | null;
  /** Global dedupe key; records sharing a non-null key count once. */
  dedupeKey: string | null;
}

export interface AgentUsageTotals {
  agent: UsageAgent;
  totals: UsageTokenTotals;
  totalTokens: number;
  costUsd: number;
  records: number;
  unpricedRecords: number;
  sessions: number;
}

export interface ModelUsageTotals {
  agent: UsageAgent;
  model: string;
  totals: UsageTokenTotals;
  totalTokens: number;
  costUsd: number;
  records: number;
  unpricedRecords: number;
}

export interface UsageSourceStatus {
  agent: UsageAgent;
  path: string;
  status: 'scanned' | 'missing' | 'error';
  files: number;
  message?: string;
}

/** One time bucket (a calendar day, or a clock hour for 24h windows). */
export interface UsageBucket {
  /** `YYYY-MM-DD` for day resolution; ISO hour start for hour resolution. */
  start: string;
  costUsd: number;
  totalTokens: number;
  byAgent: Record<string, { costUsd: number; totalTokens: number }>;
}

export interface UsageSummary {
  generatedAt: string;
  /** Number of days covered by the summary window. */
  days: number;
  /** Bucket granularity: hourly for 1-day windows, daily otherwise. */
  resolution: 'day' | 'hour';
  buckets: UsageBucket[];
  totals: UsageTokenTotals;
  totalTokens: number;
  /** API-equivalent cost estimate (provider-reported when available). */
  costUsd: number;
  /** Estimated savings from cached input vs uncached pricing. */
  cacheSavingsUsd: number;
  records: number;
  /** Records that could not be priced (no provider cost, no known rate). */
  unpricedRecords: number;
  sessions: number;
  agents: AgentUsageTotals[];
  models: ModelUsageTotals[];
  sources: UsageSourceStatus[];
  scanDurationMs: number;
  /**
   * Opaque record fingerprints for cross-device cloud dedup. Present on
   * cloud-bound snapshots; safe to omit in local UI responses.
   */
  dedupeKeys?: string[];
  /**
   * Compact priced events for exact cross-device merge. Omitted when the
   * window is too large to fit the cloud snapshot budget.
   */
  events?: UsageCloudEvent[];
}

/** One priced usage event shipped with cloud snapshots for exact merge. */
export interface UsageCloudEvent {
  key: string;
  agent: UsageAgent;
  model: string;
  timestampMs: number;
  sessionId: string;
  totals: UsageTokenTotals;
  costUsd: number;
  cacheSavingsUsd: number;
  unpriced: boolean;
}
