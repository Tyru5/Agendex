import type { Driver } from 'driver.js';
import { useCallback, useEffect, useRef } from 'react';
import {
  isProductTourPending,
  PRODUCT_TOUR_VERSION,
  type ProductTourState,
  type ProductTourStep,
  startProductTour,
} from './productTour.ts';

/** Time for shell transitions (sidebar reveal) to settle before measuring targets. */
const START_DELAY_MS = 350;

export interface UseProductTourOptions {
  steps: readonly ProductTourStep[];
  state: ProductTourState;
  /** Gate auto-start until the shell has data on screen (plans loaded, online). */
  ready: boolean;
  /** Runs before the tour starts; use it to reveal collapsed chrome the steps point at. */
  onBeforeStart?: () => void;
}

/**
 * Auto-starts the product tour once per mount when the persisted state says
 * the current version has not been completed, and exposes `replay` for
 * on-demand runs. Completion (finish or dismiss) is persisted via
 * `state.markCompleted`.
 *
 * At most one tour is ever live: a new `replay` cancels a start that is still
 * waiting on its delay and tears down a running driver before scheduling.
 */
export function useProductTour({ steps, state, ready, onBeforeStart }: UseProductTourOptions) {
  const driverRef = useRef<Driver | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const autoStartedRef = useRef(false);
  const latest = useRef({ steps, state, onBeforeStart });
  latest.current = { steps, state, onBeforeStart };

  const cancelPendingStart = useCallback(() => {
    if (startTimerRef.current === null) return;
    window.clearTimeout(startTimerRef.current);
    startTimerRef.current = null;
  }, []);

  const start = useCallback(() => {
    cancelPendingStart();
    driverRef.current?.destroy();
    driverRef.current = null;
    latest.current.onBeforeStart?.();
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null;
      driverRef.current = startProductTour(latest.current.steps, {
        onFinish: () => {
          driverRef.current = null;
          // `markCompleted` may hit the network (account-scoped state). A
          // failure must not surface as an unhandled rejection; the tour simply
          // shows again next visit, and the console explains why.
          Promise.resolve()
            .then(() => latest.current.state.markCompleted(PRODUCT_TOUR_VERSION))
            .catch((error: unknown) => {
              console.error('Failed to persist product tour completion', error);
            });
        },
      });
    }, START_DELAY_MS);
  }, [cancelPendingStart]);

  const pending = isProductTourPending(state);
  useEffect(() => {
    if (autoStartedRef.current || !ready || !pending) return;
    autoStartedRef.current = true;
    start();
  }, [pending, ready, start]);

  useEffect(
    () => () => {
      cancelPendingStart();
      // Public `destroy()` bypasses `onDestroyStarted`, so unmounting mid-tour
      // does not record completion (see `startProductTour`).
      driverRef.current?.destroy();
      driverRef.current = null;
    },
    [cancelPendingStart],
  );

  return { replay: start };
}
