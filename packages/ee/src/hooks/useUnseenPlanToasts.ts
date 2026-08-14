import { getAgentLabel, type Plan, type PlanState } from '@agendex/web';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { registerClearAllPlanToasts, setActivePlanToastCount } from './plan-toast-store.ts';
import {
  isActiveToastVersion,
  planToastId,
  shouldShowPlanToast,
  truncateTitle,
} from './unseen-plan-toast-utils.ts';

type ActiveToast = {
  updatedAt: string;
};

export function useUnseenPlanToasts({
  plans,
  planState,
  isPro,
  ready,
  baselineKey,
  selectedPlanId,
  onSelectPlan,
}: {
  plans: Plan[];
  planState: PlanState;
  isPro: boolean;
  ready: boolean;
  /** When this changes (e.g. local ↔ cloud), re-baseline without toasting. */
  baselineKey: string;
  selectedPlanId?: string;
  onSelectPlan: (plan: Plan) => void;
}) {
  // Last notified updatedAt per planId — prevents exact duplicate re-fires.
  const notifiedUpdatedAtRef = useRef(new Map<string, string>());
  // Currently rendered toasts, keyed by planId.
  const activeToastsRef = useRef(new Map<string, ActiveToast>());
  const baselineEstablishedRef = useRef(false);
  const baselineKeyRef = useRef(baselineKey);
  // Latest onSelectPlan for toast handlers without stale closures.
  const onSelectPlanRef = useRef(onSelectPlan);
  onSelectPlanRef.current = onSelectPlan;

  const dismissActiveToastsRef = useRef(() => {});

  dismissActiveToastsRef.current = () => {
    // Snapshot, then clear the live map *before* dismiss so any Sonner callback
    // (including a replaced toast version A after version B was shown) sees no
    // active entry and cannot mutate tracking for a newer toast.
    const entries = [...activeToastsRef.current.entries()];
    activeToastsRef.current = new Map();
    setActivePlanToastCount(0);
    for (const [planId] of entries) {
      toast.dismiss(planToastId(planId));
    }
  };

  // Register clear-all once; handler always reads current refs.
  useEffect(() => {
    registerClearAllPlanToasts(() => {
      dismissActiveToastsRef.current();
    });
    return () => {
      registerClearAllPlanToasts(null);
      // Drop active count (and dismiss UI) so PlanToaster does not keep
      // Clear all bound to a removed handler after unmount.
      dismissActiveToastsRef.current();
    };
  }, []);

  useEffect(() => {
    // One effect owns the baseline lifecycle: reset when not ready / not Pro,
    // re-baseline on mode switches, then toast only post-baseline arrivals.
    if (!isPro || !ready) {
      baselineEstablishedRef.current = false;
      return;
    }

    // Mode switches (and similar key changes) must re-baseline the active plan
    // set; otherwise every already-unseen plan in the new mode looks like a
    // fresh arrival and floods toasts.
    if (baselineKeyRef.current !== baselineKey) {
      baselineKeyRef.current = baselineKey;
      baselineEstablishedRef.current = false;
      // Dismiss rendered toasts from the previous mode before clearing tracking;
      // otherwise stale View actions call onSelectPlan with the wrong mode's plan.
      dismissActiveToastsRef.current();
      notifiedUpdatedAtRef.current = new Map();
    }

    const candidates = plans.filter(
      (plan) => plan.id !== selectedPlanId && planState.isUnseen(plan.id, plan.updatedAt),
    );

    if (!baselineEstablishedRef.current) {
      for (const plan of candidates) {
        notifiedUpdatedAtRef.current.set(plan.id, plan.updatedAt);
      }
      baselineEstablishedRef.current = true;
      return;
    }

    for (const plan of candidates) {
      const lastNotified = notifiedUpdatedAtRef.current.get(plan.id);
      if (!shouldShowPlanToast(lastNotified, plan.updatedAt)) continue;

      notifiedUpdatedAtRef.current.set(plan.id, plan.updatedAt);
      activeToastsRef.current.set(plan.id, { updatedAt: plan.updatedAt });
      setActivePlanToastCount(activeToastsRef.current.size);

      const toastId = planToastId(plan.id);

      // Version-gated settle: only the active toast version may clear the map
      // entry. Replaced versions and bulk-cleared toasts no-op, so a delayed
      // Sonner callback for version A cannot mutate tracking for B.
      // Toasts never markSeen — unread dots stay until the plan is opened.
      const settleToast = () => {
        const current = activeToastsRef.current.get(plan.id);
        if (!isActiveToastVersion(current?.updatedAt, plan.updatedAt)) return;
        activeToastsRef.current.delete(plan.id);
        setActivePlanToastCount(activeToastsRef.current.size);
      };

      const openPlan = () => {
        onSelectPlanRef.current(plan);
        toast.dismiss(toastId);
      };

      toast(truncateTitle(plan.title), {
        id: toastId,
        description: getAgentLabel(plan.agent),
        onClick: openPlan,
        onDismiss: settleToast,
        onAutoClose: settleToast,
        action: {
          label: 'View',
          onClick: openPlan,
        },
      });
    }
  }, [plans, planState, isPro, ready, baselineKey, selectedPlanId, onSelectPlan]);
}
