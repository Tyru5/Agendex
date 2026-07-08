const MAX_TITLE_LENGTH = 60;

export function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export function unseenPlanKey(planId: string, updatedAt: string): string {
  return `${planId}:${updatedAt}`;
}
