import { useCallback, useSyncExternalStore } from 'react';
import type { ProductTourState } from './productTour.ts';

const STORAGE_KEY = 'agendex_tour_completed_version';
const CHANGE_EVENT = 'agendex:tour-state-change';

function readCompletedVersion(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function writeCompletedVersion(version: number | null) {
  if (version === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, String(version));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Browser-local tour state for shells without a user account (OSS, EE local mode). */
export function useLocalProductTourState(): ProductTourState & { reset: () => void } {
  const completedVersion = useSyncExternalStore(subscribe, readCompletedVersion, () => null);
  const markCompleted = useCallback((version: number) => writeCompletedVersion(version), []);
  const reset = useCallback(() => writeCompletedVersion(null), []);
  return { completedVersion, markCompleted, reset };
}
