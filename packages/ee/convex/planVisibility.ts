import { assessPlanValue, type PlanValueAssessment } from '@agendex/shared/plan-value';

type PlanMetadata = Record<string, unknown>;

type PlanWithMetadata = {
  title?: string;
  content?: string;
  metadata?: unknown;
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

export function filterVisiblePlans<T extends PlanWithMetadata>(plans: T[]): T[] {
  return plans.filter(isVisiblePlan);
}
