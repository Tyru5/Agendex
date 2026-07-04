import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';

/**
 * Content for a single cloud plan, fetched lazily when a plan is opened —
 * `getMyPublishedPlans` ships list items without `content`.
 *
 * Returns `undefined` while inactive (null planId) or loading, and `''` when
 * the plan is inaccessible (deleted, hidden, or a stale id): the backing query
 * returns null instead of throwing, so a bad id can never crash the app to an
 * error boundary.
 */
export function useCloudPlanContent(planId: string | null): string | undefined {
  const result = useQuery(api.plans.getMyPlanContent, planId ? { planId } : 'skip');

  if (!planId || result === undefined) return undefined;
  return result?.content ?? '';
}
