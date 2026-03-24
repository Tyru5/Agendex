import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'agendex_pinned_plans';

type PinnedMap = Record<string, true>;

let cached: PinnedMap = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
})();

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function snapshot() {
  return cached;
}

function write(next: PinnedMap) {
  cached = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const cb of listeners) cb();
}

export function usePinnedPlans() {
  const pinned = useSyncExternalStore(subscribe, snapshot);

  const isPinned = useCallback((planId: string) => pinned[planId] === true, [pinned]);

  const setPinned = useCallback((planId: string, nextPinned: boolean) => {
    const current = snapshot();
    if (nextPinned) {
      if (current[planId]) return;
      write({ ...current, [planId]: true });
      return;
    }
    if (!current[planId]) return;
    const next = { ...current };
    delete next[planId];
    write(next);
  }, []);

  return { isPinned, setPinned };
}
