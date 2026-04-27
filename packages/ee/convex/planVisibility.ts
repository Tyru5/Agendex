type PlanWithMetadata = {
  metadata?: unknown;
};

export function hasLowValueMetadata(metadata: unknown): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).lowValue === true
  );
}

export function isVisiblePlan(plan: PlanWithMetadata): boolean {
  return !hasLowValueMetadata(plan.metadata);
}

export function filterVisiblePlans<T extends PlanWithMetadata>(plans: T[]): T[] {
  return plans.filter(isVisiblePlan);
}
