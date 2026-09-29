import { parseFilePlanQuery } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { usePaginatedQuery, useQuery, useMutation } from 'convex/react';
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
  const { results, status, loadMore } = usePaginatedQuery(
    api.filePlanMentions.lookup,
    active ? { files: parsed.files, workspace } : 'skip',
    { initialNumItems: 100 },
  );
  useEffect(() => {
    if (active && status === 'CanLoadMore') loadMore(100);
  }, [active, loadMore, status]);
  const indexing = useQuery(api.filePlanMentions.indexingStatus, enabled ? {} : 'skip');
  const ensureIndex = useMutation(api.filePlanMentions.ensureIndex);
  useEffect(() => {
    if (enabled && indexing?.complete === false)
      void ensureIndex({}).catch(() => {
        /* Cron retries migration; existing indexed results stay available. */
      });
  }, [enabled, ensureIndex, indexing?.complete]);
  const ids = useMemo(() => (active ? new Set<string>(results) : EMPTY_IDS), [active, results]);
  return {
    indexingComplete: indexing?.complete,
    ids: enabled && (parsed.files.length || parsed.error) ? ids : undefined,
    loading:
      enabled && parsed.files.length > 0 && !parsed.error && (!active || status !== 'Exhausted'),
    error: enabled ? (parsed.error ?? null) : null,
    notice:
      enabled && parsed.files.length && indexing && !indexing.complete
        ? 'Some synced file references are not indexed yet; results and counts may be incomplete.'
        : undefined,
  };
}
