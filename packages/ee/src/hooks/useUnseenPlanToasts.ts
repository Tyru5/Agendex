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
  // Latest planState / onSelectPlan for clear-all and toast handlers without stale closures.
  const planStateRef = useRef(planState);
  const onSelectPlanRef = useRef(onSelectPlan);
  planStateRef.current = planState;
  onSelectPlanRef.current = onSelectPlan;

  const dismissActiveToastsRef = useRef((options: { markSeen: boolean }) => {
    void options;
  });

  dismissActiveToastsRef.current = (options: { markSeen: boolean }) => {
    // Snapshot, then clear the live map *before* dismiss so any Sonner callback
    // (including a replaced toast version A after version B was shown) sees no
    // active entry and cannot markSeen a stale updatedAt over a newer one.
    const entries = [...activeToastsRef.current.entries()];
    activeToastsRef.current = new Map();
    setActivePlanToastCount(0);
    for (const [planId, entry] of entries) {
      if (options.markSeen) {
        planStateRef.current.markSeen(planId, entry.updatedAt);
      }
      toast.dismiss(planToastId(planId));
    }
  };

  // Register clear-all once; handler always reads current refs.
  useEffect(() => {
    registerClearAllPlanToasts(() => {
      dismissActiveToastsRef.current({ markSeen: true });
    });
    return () => {
      registerClearAllPlanToasts(null);
      // Drop active count (and dismiss UI) so PlanToaster does not keep
      // Clear all bound to a removed handler after unmount.
      dismissActiveToastsRef.current({ markSeen: false });
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
      // markSeen: false — mode switch is not user acknowledgment (map is cleared
      // first so Sonner onDismiss cannot silently mark plans seen).
      dismissActiveToastsRef.current({ markSeen: false });
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
      // entry and markSeen. Replaced versions and bulk-cleared toasts no-op, so a
      // delayed Sonner callback for version A cannot overwrite seen state for B.
      const settleToast = () => {
        const current = activeToastsRef.current.get(plan.id);
        if (!isActiveToastVersion(current?.updatedAt, plan.updatedAt)) return;
        activeToastsRef.current.delete(plan.id);
        setActivePlanToastCount(activeToastsRef.current.size);
        planStateRef.current.markSeen(plan.id, plan.updatedAt);
      };

      const openPlan = () => {
        onSelectPlanRef.current(plan);
        // toast.dismiss triggers onDismiss (sonner v2), which marks seen once.
        toast.dismiss(toastId);
      };

      toast(truncateTitle(plan.title), {
        id: toastId,
        description: getAgentLabel(plan.agent),
        onClick: openPlan,
        // X / swipe dismiss and programmatic dismiss skip onClick; auto-close
        // uses onAutoClose only (not onDismiss). Without markSeen, notified
        // suppresses re-toast and the plan stays unseen with no remaining UI path.
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
