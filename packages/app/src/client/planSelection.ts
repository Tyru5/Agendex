/**
 * Whether a `?plan=` deep link points at a plan that no longer exists. Until the first
 * plan list has loaded, every id looks missing, so the selection must be kept.
 */
export function isStalePlanSelection(
  selectedPlanId: string | null,
  loading: boolean,
  plansById: ReadonlyMap<string, unknown>,
): boolean {
  return Boolean(selectedPlanId) && !loading && !plansById.has(selectedPlanId ?? '');
}
