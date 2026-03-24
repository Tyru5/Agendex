import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'agendex_seen_plans';

type SeenMap = Record<string, string>;

let cached: SeenMap = (() => {
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

function write(next: SeenMap) {
  cached = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const cb of listeners) cb();
}

export function seedSeen(plans: { id: string; updatedAt: string }[]) {
  const current = snapshot();
  if (Object.keys(current).length === 0) {
    const seeded: SeenMap = {};
    for (const p of plans) seeded[p.id] = p.updatedAt;
    write(seeded);
    return;
  }
  let changed = false;
  const next = { ...current };
  for (const p of plans) {
    if (!(p.id in next)) {
      next[p.id] = p.updatedAt;
      changed = true;
    }
  }
  if (changed) write(next);
}

export function useSeenPlans() {
  const seen = useSyncExternalStore(subscribe, snapshot);

  const isUnseen = useCallback(
    (planId: string, updatedAt: string) => seen[planId] !== updatedAt,
    [seen],
  );

  const markSeen = useCallback((planId: string, updatedAt: string) => {
    const current = snapshot();
    if (current[planId] === updatedAt) return;
    write({ ...current, [planId]: updatedAt });
  }, []);

  const markUnseen = useCallback((planId: string) => {
    const current = snapshot();
    if (!(planId in current)) return;
    const next = { ...current };
    delete next[planId];
    write(next);
  }, []);

  const markAllSeen = useCallback((plans: { id: string; updatedAt: string }[]) => {
    const current = snapshot();
    const next = { ...current };
    let changed = false;
    for (const p of plans) {
      if (next[p.id] !== p.updatedAt) {
        next[p.id] = p.updatedAt;
        changed = true;
      }
    }
    if (changed) write(next);
  }, []);

  return { isUnseen, markSeen, markUnseen, markAllSeen };
}
