const MAX_TITLE_LENGTH = 60;

/** Approximate toast card height + stack gap used for viewport capacity. */
export const TOAST_SLOT_HEIGHT_PX = 88;
/** Top/bottom chrome + Clear all control reserve. */
export const TOAST_VIEWPORT_PADDING_PX = 96;

export function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export function unseenPlanKey(planId: string, updatedAt: string): string {
  return `${planId}:${updatedAt}`;
}

/** Stable Sonner toast id — one toast per plan. */
export function planToastId(planId: string): string {
  return `plan-toast:${planId}`;
}

/** Skip exact re-fires; allow show/replace when updatedAt advances. */
export function shouldShowPlanToast(
  lastNotifiedUpdatedAt: string | undefined,
  nextUpdatedAt: string,
): boolean {
  return lastNotifiedUpdatedAt !== nextUpdatedAt;
}

/**
 * Whether a toast dismiss/auto-close callback belongs to the currently tracked
 * toast version. Stale versions (replaced by a newer updatedAt, or cleared by
 * bulk dismiss) must not mutate the active map.
 */
export function isActiveToastVersion(
  activeUpdatedAt: string | undefined,
  toastUpdatedAt: string,
): boolean {
  return activeUpdatedAt === toastUpdatedAt;
}

export function shouldShowClearAll(activeCount: number): boolean {
  return activeCount >= 2;
}

/** How many toasts fit in the viewport without overflowing. Always ≥ 1. */
export function maxVisibleToasts(
  viewportHeightPx: number,
  slotHeightPx = TOAST_SLOT_HEIGHT_PX,
  paddingPx = TOAST_VIEWPORT_PADDING_PX,
): number {
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) return 1;
  const usable = Math.max(0, viewportHeightPx - paddingPx);
  return Math.max(1, Math.floor(usable / slotHeightPx));
}
