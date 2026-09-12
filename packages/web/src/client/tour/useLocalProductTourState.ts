import { useCallback, useSyncExternalStore } from 'react';
import type { ProductTourState } from './productTour.ts';

const STORAGE_KEY = 'agendex_tour_completed_version';
const CHANGE_EVENT = 'agendex:tour-state-change';

/**
 * `localStorage` access throws (`SecurityError`) when storage is disabled or
 * blocked by a privacy setting. Reads run inside a render-time snapshot, so
 * every access is guarded; the tour then behaves as if never completed and
 * completion is simply not remembered.
 */
function readCompletedVersion(): number | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function writeCompletedVersion(version: number | null) {
  try {
    if (version === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(version));
  } catch (error) {
    console.warn('Product tour state could not be saved to browser storage', error);
    return;
  }
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
