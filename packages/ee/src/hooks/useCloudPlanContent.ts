import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useMemo } from 'react';

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

/**
 * Hydrate a list-item plan with its body when running in cloud mode.
 * Local plans and optimistic editor copies already carry content and skip the fetch.
 * Used for both the primary selection and the split-view pane.
 */
export function useHydratedCloudPlan(
  mode: 'local' | 'cloud',
  plan: Plan | undefined,
): Plan | undefined {
  const needsContent = mode === 'cloud' && Boolean(plan && !plan.content);
  const content = useCloudPlanContent(needsContent && plan ? plan.id : null);

  return useMemo(() => {
    if (!plan) return undefined;
    if (mode !== 'cloud' || plan.content) return plan;
    return { ...plan, content: content ?? '' };
  }, [plan, mode, content]);
}
