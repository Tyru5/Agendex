/** Session usage belongs to a session, never to an individual plan. Browser-safe. */
import {
  emptyTokenTotals,
  addTokenTotals,
  totalTokens,
  type UsageAgent,
  type UsageCloudEvent,
  type UsageSummary,
} from './types.ts';

export type SessionCostPlan = {
  agent: string;
  metadata?: Record<string, unknown>;
  content?: string;
};
export type SessionIdentity = { agent: UsageAgent; sessionId: string; sessionAliases?: string[] };
export type SessionCostUnavailableReason =
  | 'unsupported-agent'
  | 'missing-session'
  | 'ambiguous-session'
  | 'unverified-session'
  | 'usage-unavailable'
  | 'incomplete-snapshot'
  | 'no-records';
export type PlanSessionCost = {
  status: 'available' | 'unavailable';
  reason: SessionCostUnavailableReason | null;
  agent: UsageAgent | null;
  sessionId: string | null;
  windowDays: number;
  generatedAt: string | null;
  currency: 'USD';
  costUsd: number | null;
  pricing: 'estimated' | 'partial' | 'unpriced' | null;
  totalTokens: number | null;
  records: number;
  unpricedRecords: number;
  sharedPlanCount: number | null;
  models: Array<{
    model: string;
    totalTokens: number;
    costUsd: number | null;
    unpricedRecords: number;
  }>;
};

const AGENTS = new Set(['claude-code', 'codex-cli', 'grok']);
const SESSION_FIELDS = ['sessionId', 'session_id'];
function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= 512
    ? value.trim()
    : undefined;
}

/** No timestamp, workspace, title, parent-thread, or filename guessing. */
export function resolveUsageSession(
  plan: SessionCostPlan,
): SessionIdentity | SessionCostUnavailableReason {
  if (!AGENTS.has(plan.agent)) return 'unsupported-agent';
  const metadata = plan.metadata ?? {};
  const ids = new Set(
    SESSION_FIELDS.map((field) => string(metadata[field])).filter((id): id is string =>
      Boolean(id),
    ),
  );
  if (ids.size > 1 || metadata.sessionIdOrigin === 'ambiguous') return 'ambiguous-session';
  const sessionId = [...ids][0];
  if (!sessionId) return 'missing-session';
  const source = string(metadata.sessionIdSource);
  if (source && source !== plan.agent) return 'unverified-session';
  // Claude's historical adapter guessed session IDs from plausible filenames.
  // Only explicit frontmatter provenance is a verified session association.
  if (plan.agent === 'claude-code' && metadata.sessionIdOrigin !== 'frontmatter')
    return 'unverified-session';
  const transcriptId =
    plan.agent === 'grok' && source === 'grok' ? string(metadata.sessionTranscriptId) : undefined;
  return {
    agent: plan.agent as UsageAgent,
    sessionId,
    ...(transcriptId && transcriptId !== sessionId ? { sessionAliases: [transcriptId] } : {}),
  };
}

export function unavailableSessionCost(
  reason: SessionCostUnavailableReason,
  identity?: SessionIdentity,
  windowDays = 90,
): PlanSessionCost {
  return {
    status: 'unavailable',
    reason,
    agent: identity?.agent ?? null,
    sessionId: identity?.sessionId ?? null,
    windowDays,
    generatedAt: null,
    currency: 'USD',
    costUsd: null,
    pricing: null,
    totalTokens: null,
    records: 0,
    unpricedRecords: 0,
    sharedPlanCount: null,
    models: [],
  };
}

export function countPlansInSession(
  plans: readonly SessionCostPlan[],
  identity: SessionIdentity,
): number {
  return plans.filter((plan) => {
    const candidate = resolveUsageSession(plan);
    return (
      typeof candidate !== 'string' &&
      candidate.agent === identity.agent &&
      candidate.sessionId === identity.sessionId
    );
  }).length;
}

/** Input summary MUST have been filtered to this exact agent and session before aggregation. */
export function summarizeSessionCost(
  identity: SessionIdentity,
  summary: UsageSummary,
  sharedPlanCount: number | null = null,
): PlanSessionCost {
  if (!summary.records) return unavailableSessionCost('no-records', identity, summary.days);
  const unpriced = summary.unpricedRecords;
  return {
    status: 'available',
    reason: null,
    agent: identity.agent,
    sessionId: identity.sessionId,
    windowDays: summary.days,
    generatedAt: summary.generatedAt,
    currency: 'USD',
    costUsd: unpriced === summary.records ? null : summary.costUsd,
    pricing: unpriced === summary.records ? 'unpriced' : unpriced > 0 ? 'partial' : 'estimated',
    totalTokens: summary.totalTokens,
    records: summary.records,
    unpricedRecords: unpriced,
    sharedPlanCount,
    models: summary.models.map((model) => ({
      model: model.model,
      totalTokens: model.totalTokens,
      costUsd: model.unpricedRecords === model.records ? null : model.costUsd,
      unpricedRecords: model.unpricedRecords,
    })),
  };
}

export type SessionUsageSnapshot = Pick<
  UsageSummary,
  'days' | 'generatedAt' | 'records' | 'events'
> & { cloudFormatVersion?: number };

/** Complete event snapshots are required: a capped aggregate cannot prove session spend. */
export function sessionCostFromSnapshots(
  identity: SessionIdentity,
  snapshots: readonly SessionUsageSnapshot[],
  sharedPlanCount: number | null = null,
  nowMs = Date.now(),
): PlanSessionCost {
  const windowDays = 90;
  const sinceMs = nowMs - windowDays * 24 * 60 * 60_000;
  const windows = snapshots.filter((snapshot) => snapshot.days === windowDays);
  if (!windows.length) return unavailableSessionCost('usage-unavailable', identity, windowDays);
  if (
    windows.some((snapshot) => snapshot.records > 0 && snapshot.events?.length !== snapshot.records)
  )
    return unavailableSessionCost('incomplete-snapshot', identity, windowDays);

  // V2 dual-writes legacy identities. Reconcile those aliases before deduplication,
  // matching the heartbeat merge contract; prefer current ownership session IDs.
  const contentIdentity = (event: UsageCloudEvent) =>
    JSON.stringify([event.agent, event.sessionId, event.timestampMs, event.model, event.totals]);
  const v2ByLegacyKey = new Map<string, Set<string>>();
  for (const snapshot of windows)
    for (const event of snapshot.events ?? []) {
      if (snapshot.cloudFormatVersion !== 2 || !event.ownershipKey) continue;
      const identities = v2ByLegacyKey.get(event.key) ?? new Set<string>();
      identities.add(contentIdentity(event));
      v2ByLegacyKey.set(event.key, identities);
    }
  const events = new Map<string, UsageCloudEvent>();
  for (const snapshot of windows)
    for (const event of snapshot.events ?? []) {
      const isV2 = snapshot.cloudFormatVersion === 2;
      if (!isV2 && v2ByLegacyKey.get(event.key)?.has(contentIdentity(event))) continue;
      const key = isV2 ? (event.ownershipKey ?? event.key) : event.key;
      if (!events.has(key)) events.set(key, event);
    }
  const matched = [...events.values()].filter(
    (event) =>
      event.timestampMs >= sinceMs &&
      event.timestampMs <= nowMs + 60_000 &&
      event.agent === identity.agent &&
      [identity.sessionId, ...(identity.sessionAliases ?? [])].includes(
        event.ownershipSessionId ?? event.sessionId,
      ),
  );
  const totals = emptyTokenTotals();
  const models = new Map<string, UsageSummary['models'][number]>();
  let costUsd = 0;
  let unpricedRecords = 0;
  for (const event of matched) {
    addTokenTotals(totals, event.totals);
    costUsd += event.costUsd;
    if (event.unpriced) unpricedRecords++;
    const model = models.get(event.model) ?? {
      agent: identity.agent,
      model: event.model,
      totals: emptyTokenTotals(),
      totalTokens: 0,
      costUsd: 0,
      records: 0,
      unpricedRecords: 0,
    };
    addTokenTotals(model.totals, event.totals);
    model.totalTokens += totalTokens(event.totals);
    model.costUsd += event.costUsd;
    model.records++;
    if (event.unpriced) model.unpricedRecords++;
    models.set(event.model, model);
  }
  return summarizeSessionCost(
    identity,
    {
      days: windowDays,
      generatedAt: windows.reduce(
        (latest, snapshot) => (snapshot.generatedAt > latest ? snapshot.generatedAt : latest),
        '',
      ),
      resolution: 'day',
      buckets: [],
      totals,
      totalTokens: totalTokens(totals),
      costUsd,
      cacheSavingsUsd: 0,
      records: matched.length,
      unpricedRecords,
      sessions: matched.length ? 1 : 0,
      agents: [],
      models: [...models.values()],
      sources: [],
      scanDurationMs: 0,
    },
    sharedPlanCount,
  );
}
