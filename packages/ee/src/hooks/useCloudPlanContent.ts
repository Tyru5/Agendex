import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useMemo } from 'react';

/**
 * Content for a single cloud plan, fetched lazily when a plan is opened —
 * `getMyPublishedPlans` ships list items without `content`.
 *
 * - `undefined` — inactive (null planId) or still loading
 * - `null` — query resolved but the plan is inaccessible (deleted, hidden, or
 *   a stale id). The backing query returns null instead of throwing.
 * - `string` — ready body (may be empty for a legitimately empty plan)
 */
export function useCloudPlanContent(planId: string | null): string | null | undefined {
  const result = useQuery(api.plans.getMyPlanContent, planId ? { planId } : 'skip');

  if (!planId || result === undefined) return undefined;
  if (result === null) return null;
  return result.content ?? '';
}

export type HydratedCloudPlan = {
  plan: Plan | undefined;
  /** True while a cloud list item's body is still fetching. */
  contentLoading: boolean;
  /** True when the content query resolved but the plan is inaccessible. */
  contentMissing: boolean;
};

/**
 * Hydrate a list-item plan with its body when running in cloud mode.
 * Local plans and optimistic editor copies already carry content and skip the fetch.
 * Used for both the primary selection and the split-view pane.
 *
 * Callers that must not treat a pending or missing empty body as real content
 * (e.g. plan compare) should wait on `contentLoading` / `contentMissing`
 * before rendering derived diffs.
 */
export function useHydratedCloudPlan(
  mode: 'local' | 'cloud',
  plan: Plan | undefined,
): HydratedCloudPlan {
  const needsContent = mode === 'cloud' && Boolean(plan && !plan.content);
  const content = useCloudPlanContent(needsContent && plan ? plan.id : null);

  const hydrated = useMemo(() => {
    if (!plan) return undefined;
    if (mode !== 'cloud' || plan.content) return plan;
    // Viewer/editor tolerate an empty stub; compare gates on contentMissing.
    return { ...plan, content: content ?? '' };
  }, [plan, mode, content]);

  return {
    plan: hydrated,
    contentLoading: needsContent && content === undefined,
    contentMissing: needsContent && content === null,
  };
}
