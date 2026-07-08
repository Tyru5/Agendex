import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { usePaginatedQuery } from 'convex/react';
import { useEffect } from 'react';

// Page size for the paginated `getMyPublishedPlans` query. Deliberately small:
// even though the query strips `content` from the response, the server still
// reads full documents (up to ~1MB each) against Convex's ~8MB per-query read
// budget, so the page count must stay low enough that one page's underlying
// docs don't blow it. The hook eagerly loads every page below, so a smaller
// page only costs extra round-trips, not completeness.
const PLANS_PAGE_SIZE = 25;

export function useCloudPlans(): {
  plans: Plan[];
  loading: boolean;
  /** True once every page has been fetched (or the query failed). */
  complete: boolean;
  error: string | null;
} {
  const { results, status, loadMore } = usePaginatedQuery(
    api.plans.getMyPublishedPlans,
    {},
    { initialNumItems: PLANS_PAGE_SIZE },
  );

  // The list UI aggregates and searches over the FULL set (agent counts, tag
  // filters, content search), so eagerly walk every page. Each page is its own
  // bounded query — only the client ever holds the whole collection.
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(PLANS_PAGE_SIZE);
  }, [status, loadMore]);

  // `loading` covers only the first page so the list can render progressively;
  // `complete` waits until pagination is exhausted so callers that need the
  // full set (e.g. unseen-plan toast baselines) do not run early.
  const complete = status === 'Exhausted';

  if (status === 'LoadingFirstPage') {
    return { plans: [], loading: true, complete: false, error: null };
  }

  try {
    // Convex query returns untyped documents
    // oxlint-disable-next-line typescript/no-explicit-any
    const plans: Plan[] = results.map((p: any) => ({
      id: p._id,
      ownerId: p.ownerId,
      agent: p.agent,
      title: p.title,
      // List items ship without content (see getMyPublishedPlans); the detail
      // view hydrates it on open via useCloudPlanContent.
      content: p.content ?? '',
      filePath: p.filePath ?? '',
      format: p.format,
      createdAt: new Date(p.createdAt).toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
      workspace: p.workspace,
      metadata: (p.metadata as Record<string, unknown>) ?? {},
    }));
    return { plans, loading: false, complete, error: null };
  } catch (e) {
    return {
      plans: [],
      loading: false,
      complete: true,
      error: e instanceof Error ? e.message : 'Failed to load cloud plans',
    };
  }
}
