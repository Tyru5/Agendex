/**
 * Whether a `?plan=` deep link points at a plan that no longer exists. Until a plan
 * list has loaded successfully, every id looks missing, so the selection must be kept;
 * that includes a failed load while the backend is unreachable.
 */
export function isStalePlanSelection(
  selectedPlanId: string | null,
  listReady: boolean,
  plansById: ReadonlyMap<string, unknown>,
): boolean {
  return Boolean(selectedPlanId) && listReady && !plansById.has(selectedPlanId ?? '');
}
