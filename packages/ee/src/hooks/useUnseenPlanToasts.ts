import { getAgentLabel, type Plan, type PlanState } from '@agendex/web';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { truncateTitle, unseenPlanKey } from './unseen-plan-toast-utils.ts';

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
  const notifiedKeysRef = useRef(new Set<string>());
  const baselineEstablishedRef = useRef(false);
  const baselineKeyRef = useRef(baselineKey);

  useEffect(() => {
    if (!ready) {
      baselineEstablishedRef.current = false;
    }
  }, [ready]);

  useEffect(() => {
    if (!isPro || !ready) return;

    // Mode switches (and similar key changes) must re-baseline the active plan
    // set; otherwise every already-unseen plan in the new mode looks like a
    // fresh arrival and floods toasts.
    if (baselineKeyRef.current !== baselineKey) {
      baselineKeyRef.current = baselineKey;
      baselineEstablishedRef.current = false;
      notifiedKeysRef.current = new Set();
    }

    const candidates = plans.filter(
      (plan) => plan.id !== selectedPlanId && planState.isUnseen(plan.id, plan.updatedAt),
    );

    if (!baselineEstablishedRef.current) {
      for (const plan of candidates) {
        notifiedKeysRef.current.add(unseenPlanKey(plan.id, plan.updatedAt));
      }
      baselineEstablishedRef.current = true;
      return;
    }

    for (const plan of candidates) {
      const key = unseenPlanKey(plan.id, plan.updatedAt);
      if (notifiedKeysRef.current.has(key)) continue;
      notifiedKeysRef.current.add(key);

      const openPlan = () => {
        onSelectPlan(plan);
        planState.markSeen(plan.id, plan.updatedAt);
        toast.dismiss(key);
      };

      toast(truncateTitle(plan.title), {
        id: key,
        description: getAgentLabel(plan.agent),
        action: {
          label: 'View',
          onClick: openPlan,
        },
      });
    }
  }, [plans, planState, isPro, ready, baselineKey, selectedPlanId, onSelectPlan]);
}
