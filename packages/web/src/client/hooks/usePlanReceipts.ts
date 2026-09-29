import type { PlanReceipt, PlanReceiptSummary } from '@agendex/shared/receipts';
import { useEffect, useMemo, useState } from 'react';
import { api, hasToken, type Plan } from '../lib/api.ts';

/** Receipts follow git, not plan files, so re-check while the dashboard stays open. */
const RECEIPT_REFRESH_MS = 60_000;

/**
 * Runs `load` now, on window focus, when the tab becomes visible, and every minute while it
 * is visible. Returns the cleanup.
 */
function subscribeReceiptRefresh(load: () => void): () => void {
  load();
  const refreshQuietly = () => {
    if (document.visibilityState !== 'hidden') load();
  };
  window.addEventListener('focus', refreshQuietly);
  document.addEventListener('visibilitychange', refreshQuietly);
  const intervalId = window.setInterval(refreshQuietly, RECEIPT_REFRESH_MS);
  return () => {
    window.removeEventListener('focus', refreshQuietly);
    document.removeEventListener('visibilitychange', refreshQuietly);
    window.clearInterval(intervalId);
  };
}

export interface PlanReceiptState {
  receipt: PlanReceipt | null;
  /** True until the first answer for this plan arrives. Failures settle quietly to no receipt. */
  loading: boolean;
}

/**
 * The receipt for one plan from the local API, like `useValidatedPlanPaths`: it asks with
 * `plan.localPlanId ?? plan.id` and only when a local token exists. Pass `enabled: false` for
 * cloud plans that were never indexed locally.
 */
export function usePlanReceipt(
  plan: Pick<Plan, 'id' | 'localPlanId' | 'updatedAt'> | undefined,
  enabled = true,
): PlanReceiptState {
  const localPlanId = plan ? (plan.localPlanId ?? plan.id) : undefined;
  const active = enabled && Boolean(localPlanId) && hasToken();
  const updatedAt = plan?.updatedAt;
  const [state, setState] = useState<{
    planId: string | undefined;
    receipt: PlanReceipt | null;
    settled: boolean;
  }>({ planId: undefined, receipt: null, settled: false });

  useEffect(() => {
    if (!active || !localPlanId) return;
    let cancelled = false;
    let requestId = 0;
    const unsubscribe = subscribeReceiptRefresh(() => {
      const id = ++requestId;
      api
        .getPlanReceipt(localPlanId)
        .then(({ receipt }) => {
          if (cancelled || id !== requestId) return;
          setState({ planId: localPlanId, receipt, settled: true });
        })
        .catch(() => {
          if (cancelled || id !== requestId) return;
          // Keep a receipt already shown for this plan; a first failure settles to none.
          setState((prev) =>
            prev.planId === localPlanId
              ? { ...prev, settled: true }
              : { planId: localPlanId, receipt: null, settled: true },
          );
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // updatedAt: a rewritten plan re-reads its mentions, so refetch right away.
  }, [active, localPlanId, updatedAt]);

  const current = active && state.planId === localPlanId ? state : undefined;
  return { receipt: current?.receipt ?? null, loading: active && !current?.settled };
}

export interface PlanReceiptSummariesState {
  /** Keyed by local plan id (see `receiptSummaryForPlan`); undefined until the first answer. */
  receipts: Record<string, PlanReceiptSummary> | undefined;
  /**
   * False while enabled until the first successful answer. Failed requests retry on
   * refresh; disabled receipts and a missing local token count as settled.
   */
  settled: boolean;
}

/**
 * Receipt summaries for every locally indexed plan. Refetches when `plans` change, on focus,
 * and every minute while visible.
 */
export function usePlanReceiptSummaries(
  enabled: boolean,
  plans: readonly Pick<Plan, 'updatedAt'>[] = [],
): PlanReceiptSummariesState {
  const active = enabled && hasToken();
  const [state, setState] = useState<{
    receipts: Record<string, PlanReceiptSummary> | undefined;
    answered: boolean;
  }>({ receipts: undefined, answered: false });
  // Changes when any plan is added, removed, or rewritten.
  const plansKey = useMemo(() => {
    let latest = '';
    for (const plan of plans) if (plan.updatedAt > latest) latest = plan.updatedAt;
    return `${plans.length}:${latest}`;
  }, [plans]);

  useEffect(() => {
    if (!active) {
      // Re-enabling starts unsettled again instead of trusting an older answer.
      setState((prev) =>
        prev.answered || prev.receipts ? { receipts: undefined, answered: false } : prev,
      );
      return;
    }
    let cancelled = false;
    let requestId = 0;
    const unsubscribe = subscribeReceiptRefresh(() => {
      const id = ++requestId;
      api
        .getPlanReceiptSummaries()
        .then((body) => {
          if (cancelled || id !== requestId) return;
          setState({ receipts: body.receipts, answered: true });
        })
        // Preserve the last successful answer. A first failure must not allow the
        // brief's read boundary to advance past landings that were never shown.
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active, plansKey]);

  return active
    ? { receipts: state.receipts, settled: state.answered }
    : { receipts: undefined, settled: true };
}
