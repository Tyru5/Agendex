import type { PlanReadSource } from '@agendex/web';

export function ownedPlanReadSource(
  userId: string | undefined,
  open: PlanReadSource['open'],
  clear: PlanReadSource['clear'],
): PlanReadSource {
  return {
    scope: `cloud:${userId ?? 'pending'}`,
    canRead: (plan) => Boolean(userId && plan.ownerId === userId),
    open,
    clear,
  };
}
