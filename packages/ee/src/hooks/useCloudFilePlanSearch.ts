import { parseFilePlanQuery } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { usePaginatedQuery_experimental, useQuery_experimental, useMutation } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

const EMPTY_IDS: ReadonlySet<string> = new Set();
/** Reactive subscriptions switch atomically on workspace/query changes; all pages are walked. */
export function useCloudFilePlanSearch(query: string, workspace?: string, enabled = true) {
  const parsed = useMemo(() => parseFilePlanQuery(query), [query]);
  const key = JSON.stringify([parsed.files, workspace]);
  const [settledKey, setSettledKey] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), 200);
    return () => clearTimeout(timer);
  }, [key]);
  const active = enabled && parsed.files.length > 0 && !parsed.error && settledKey === key;
  // Object form returns query failures instead of throwing during render, so a
  // failed `file:` lookup degrades to an inline error rather than blanking the dashboard.
  const lookup = usePaginatedQuery_experimental({
    query: api.filePlanMentions.lookup,
    args: active ? { files: parsed.files, workspace } : 'skip',
    initialNumItems: 100,
  });
  const { canLoadMore, loadMore } = lookup;
  useEffect(() => {
    if (active && canLoadMore) loadMore(100);
  }, [active, canLoadMore, loadMore]);
  const indexingQuery = useQuery_experimental({
    query: api.filePlanMentions.indexingStatus,
    args: enabled ? {} : 'skip',
  });
  const indexing = indexingQuery.status === 'success' ? indexingQuery.data : undefined;
  const ensureIndex = useMutation(api.filePlanMentions.ensureIndex);
  useEffect(() => {
    if (enabled && indexing?.complete === false)
      void ensureIndex({}).catch(() => {
        /* Cron retries migration; existing indexed results stay available. */
      });
  }, [enabled, ensureIndex, indexing?.complete]);
  const lookupFailed = active && lookup.status === 'error';
  const ids = useMemo(
    () => (active && !lookupFailed ? new Set<string>(lookup.data ?? []) : EMPTY_IDS),
    [active, lookup.data, lookupFailed],
  );
  const searching = enabled && parsed.files.length > 0 && !parsed.error;
  return {
    indexingComplete: indexing?.complete,
    ids: enabled && (parsed.files.length || parsed.error) ? ids : undefined,
    loading:
      searching && !lookupFailed && (!active || lookup.status !== 'success' || lookup.canLoadMore),
    error: enabled
      ? (parsed.error ?? (lookupFailed ? 'File lookup failed. Try again in a moment.' : null))
      : null,
    notice:
      enabled && parsed.files.length && indexing && !indexing.complete
        ? 'Some synced file references are not indexed yet; results and counts may be incomplete.'
        : undefined,
  };
}
