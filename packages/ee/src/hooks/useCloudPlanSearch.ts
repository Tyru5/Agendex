import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

// Keystrokes shouldn't each spin up a server search subscription; wait for the
// term to settle before querying.
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Server-side content search for cloud plans. List items ship without
 * `content` (see `getMyPublishedPlans`), so client-side substring search can't
 * see plan bodies; this returns the ids of plans whose content matches the
 * term (Convex full-text word/prefix semantics, capped server-side) for
 * `filterPlans` to union with its metadata matches.
 *
 * Returns `undefined` while inactive, debouncing, or loading — callers treat
 * that as "no extra content matches yet".
 */
export function useCloudPlanSearch(searchTerm: string): ReadonlySet<string> | undefined {
  const trimmed = searchTerm.trim();
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    if (!trimmed) {
      setDebouncedTerm('');
      return;
    }
    const timer = setTimeout(() => setDebouncedTerm(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const ids = useQuery(api.plans.searchMyPlans, debouncedTerm ? { searchTerm: debouncedTerm } : 'skip');

  return useMemo(() => (ids ? new Set<string>(ids) : undefined), [ids]);
}
