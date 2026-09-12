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
 */
export function useProductTour({ steps, state, ready, onBeforeStart }: UseProductTourOptions) {
  const driverRef = useRef<Driver | null>(null);
  const autoStartedRef = useRef(false);
  const latest = useRef({ steps, state, onBeforeStart });
  latest.current = { steps, state, onBeforeStart };

  const start = useCallback(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
    latest.current.onBeforeStart?.();
    const timer = window.setTimeout(() => {
      driverRef.current = startProductTour(latest.current.steps, {
        onFinish: () => {
          driverRef.current = null;
          void latest.current.state.markCompleted(PRODUCT_TOUR_VERSION);
        },
      });
    }, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const pending = isProductTourPending(state);
  useEffect(() => {
    if (autoStartedRef.current || !ready || !pending) return;
    autoStartedRef.current = true;
    return start();
  }, [pending, ready, start]);

  useEffect(
    () => () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    },
    [],
  );

  return { replay: start };
}
