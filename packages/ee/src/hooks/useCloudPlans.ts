import type { Plan } from '@agendex/web';
import { decryptPlanSummary, type DecryptedPlanSummary } from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { useEffect, useSyncExternalStore } from 'react';
import {
  getCachedDecryptedSummary,
  getWorkspaceKeyringSnapshot,
  setCachedDecryptedSummary,
  subscribeWorkspaceKeyring,
  withWorkspaceKey,
} from '../lib/obfuscation-keyring';

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
  const cryptoStatus = useQuery(api.workspaceCrypto.getWorkspaceCryptoStatus, {});
  const workspaceOwnerId = cryptoStatus?.workspaceOwnerId ?? '';
  useSyncExternalStore(
    subscribeWorkspaceKeyring,
    () =>
      getWorkspaceKeyringSnapshot(workspaceOwnerId, cryptoStatus?.settings?.activeKeyEpoch ?? null),
    () =>
      getWorkspaceKeyringSnapshot(workspaceOwnerId, cryptoStatus?.settings?.activeKeyEpoch ?? null),
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
    const plans: Plan[] = results.map((p: any) => {
      let summary: DecryptedPlanSummary | undefined;
      let cryptoError: 'locked' | 'corrupt' | undefined;
      if (p.encryptedSummary && p.stableCryptoId && p.keyEpoch) {
        const cacheKey = `${p._id}:${p.updatedAt}:${p.keyEpoch}`;
        summary = getCachedDecryptedSummary<DecryptedPlanSummary>(p.ownerId, cacheKey);
        if (!summary) {
          try {
            summary = withWorkspaceKey(p.ownerId, (workspaceKey) =>
              decryptPlanSummary({
                workspaceKey,
                workspaceOwnerId: p.ownerId,
                stableCryptoId: p.stableCryptoId,
                keyEpoch: p.keyEpoch,
                envelope: p.encryptedSummary,
              }),
            );
            setCachedDecryptedSummary(p.ownerId, cacheKey, summary);
          } catch (caught) {
            cryptoError =
              caught instanceof Error && caught.message === 'Obfuscation is locked'
                ? 'locked'
                : 'corrupt';
          }
        }
      }
      return {
        id: p._id,
        localPlanId: summary?.localPlanId ?? p.localPlanId,
        ownerId: p.ownerId,
        agent: p.agent,
        title:
          summary?.title ??
          (cryptoError === 'corrupt'
            ? 'Corrupt encrypted plan'
            : cryptoError === 'locked'
              ? 'Locked plan'
              : p.title),
        content: p.content ?? '',
        filePath: summary?.filePath ?? p.filePath ?? '',
        format: p.format,
        createdAt: new Date(p.createdAt).toISOString(),
        updatedAt: new Date(p.updatedAt).toISOString(),
        workspace: summary?.workspace ?? p.workspace,
        metadata:
          (summary?.metadata as Record<string, unknown> | undefined) ??
          (p.metadata as Record<string, unknown>) ??
          {},
      };
    });
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
