import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { usePaginatedQuery } from 'convex/react';
import { useEffect } from 'react';

// Page size for the paginated `getMyPublishedPlans` query. Deliberately small:
// each plan carries its full content (up to ~1MB), and a single query reads at
// most ~8MB, so the page count must stay low enough that one page's plans don't
// blow that budget. The hook eagerly loads every page below, so a smaller page
// only costs extra round-trips, not completeness. (A fully byte-safe fix would
// stop shipping full content in the list query — see the PR notes.)
const PLANS_PAGE_SIZE = 25;

export function useCloudPlans(): {
  plans: Plan[];
  loading: boolean;
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

  if (status === 'LoadingFirstPage') {
    return { plans: [], loading: true, error: null };
  }

  try {
    // Convex query returns untyped documents
    // oxlint-disable-next-line typescript/no-explicit-any
    const plans: Plan[] = results.map((p: any) => ({
      id: p._id,
      ownerId: p.ownerId,
      agent: p.agent,
      title: p.title,
      content: p.content,
      filePath: p.filePath ?? '',
      format: p.format,
      createdAt: new Date(p.createdAt).toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
      workspace: p.workspace,
      metadata: (p.metadata as Record<string, unknown>) ?? {},
    }));
    return { plans, loading: false, error: null };
  } catch (e) {
    return {
      plans: [],
      loading: false,
      error: e instanceof Error ? e.message : 'Failed to load cloud plans',
    };
  }
}
