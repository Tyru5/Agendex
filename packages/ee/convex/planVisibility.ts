import { exactDuplicateKey } from '@agendex/shared/plan-sync-identity';
import { assessPlanValue, type PlanValueAssessment } from '@agendex/shared/plan-value';

type PlanMetadata = Record<string, unknown>;

type PlanWithMetadata = {
  title?: string;
  content?: string;
  metadata?: unknown;
};

type PlanWithDuplicateIdentity = PlanWithMetadata & {
  agent: string;
  title: string;
  updatedAt: number;
  _creationTime?: number;
  syncIdentityKey?: string;
  contentHash?: string;
};

const LOW_VALUE_METADATA_KEYS = ['lowValue', 'lowValueReasons', 'lowValueSignals'] as const;

function isRecord(value: unknown): value is PlanMetadata {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutLowValueMetadata(metadata: unknown): PlanMetadata | undefined {
  if (!isRecord(metadata)) return undefined;
  const next = { ...metadata };
  for (const key of LOW_VALUE_METADATA_KEYS) delete next[key];
  return next;
}

function emptyRecordToUndefined(metadata: PlanMetadata | undefined): PlanMetadata | undefined {
  return metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function hasLowValueMetadata(metadata: unknown): boolean {
  return isRecord(metadata) && metadata.lowValue === true;
}

export function mergePlanMetadata(existing: unknown, incoming: unknown): unknown {
  if (!isRecord(existing)) return incoming;
  if (!isRecord(incoming)) {
    const cleared = { ...existing };
    delete cleared.lowValue;
    delete cleared.lowValueReasons;
    delete cleared.lowValueSignals;
    return cleared;
  }
  const merged = { ...existing, ...incoming };
  if (incoming.lowValue !== true) {
    delete merged.lowValue;
    delete merged.lowValueReasons;
    delete merged.lowValueSignals;
  }
  return merged;
}

export function assessPlanForVisibility(plan: PlanWithMetadata): PlanValueAssessment {
  return assessPlanValue({
    title: plan.title,
    content: plan.content ?? '',
    metadata: withoutLowValueMetadata(plan.metadata),
  });
}

export function metadataWithPlanValueAssessment(
  metadata: unknown,
  plan: Pick<PlanWithMetadata, 'title' | 'content'>,
): PlanMetadata | undefined {
  const baseMetadata = withoutLowValueMetadata(metadata);
  const assessment = assessPlanValue({
    title: plan.title,
    content: plan.content ?? '',
    metadata: baseMetadata,
  });

  if (!assessment.lowValue) return emptyRecordToUndefined(baseMetadata);

  return {
    ...baseMetadata,
    lowValue: true,
    lowValueReasons: assessment.reasons,
    lowValueSignals: assessment.signals,
  };
}

export function isLikelyLowValuePlan(plan: PlanWithMetadata): boolean {
  return assessPlanForVisibility(plan).lowValue;
}

export function isVisiblePlan(plan: PlanWithMetadata): boolean {
  return !hasLowValueMetadata(plan.metadata) && !isLikelyLowValuePlan(plan);
}

// Collection reads (e.g. `getMyPublishedPlans`) filter on the PERSISTED
// low-value flag rather than re-running the full `assessPlanValue` classifier
// per plan. The classifier does non-trivial regex work over each plan's entire
// content; running it across every plan on every read pushed the query past
// Convex's 1s CPU budget. The flag is written at upload/update time
// (`metadataWithPlanValueAssessment`) and kept in sync with the current
// classifier by `backfillPlanValueMetadata` — so this is equivalent to the
// live check in steady state, without the per-plan cost. Single-doc reads
// (`isVisiblePlan`) keep the live classifier as a defense-in-depth safety net.
export function filterVisiblePlans<T extends PlanWithMetadata>(plans: T[]): T[] {
  return plans.filter((plan) => !hasLowValueMetadata(plan.metadata));
}

function duplicateKey(plan: PlanWithDuplicateIdentity): string | undefined {
  if (plan.syncIdentityKey) return `sync:${plan.syncIdentityKey}`;
  if (plan.contentHash) {
    return `exact:${exactDuplicateKey({
      agent: plan.agent,
      title: plan.title,
      contentHash: plan.contentHash,
    })}`;
  }
  return undefined;
}

function betterDuplicateWinner<T extends PlanWithDuplicateIdentity>(current: T, candidate: T): T {
  if (candidate.updatedAt !== current.updatedAt) {
    return candidate.updatedAt > current.updatedAt ? candidate : current;
  }
  return (candidate._creationTime ?? 0) > (current._creationTime ?? 0) ? candidate : current;
}

export function dedupeVisiblePlans<T extends PlanWithDuplicateIdentity>(plans: T[]): T[] {
  const winners = new Map<string, T>();

  for (const plan of plans) {
    const key = duplicateKey(plan);
    if (!key) continue;
    const existing = winners.get(key);
    winners.set(key, existing ? betterDuplicateWinner(existing, plan) : plan);
  }

  const emitted = new Set<string>();
  const result: T[] = [];

  for (const plan of plans) {
    const key = duplicateKey(plan);
    if (!key) {
      result.push(plan);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push(winners.get(key)!);
  }

  return result;
}

// Search results are already relevance-ranked. Keep the first hit per duplicate
// group instead of promoting a newer non-matching winner that was not in the
// search result set.
export function dedupeSearchPlans<T extends PlanWithDuplicateIdentity>(plans: T[]): T[] {
  const emitted = new Set<string>();
  const result: T[] = [];

  for (const plan of plans) {
    const key = duplicateKey(plan);
    if (!key) {
      result.push(plan);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push(plan);
  }

  return result;
}
