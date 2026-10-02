import type { PlanSessionCost } from '@agendex/shared/session-cost';
import { useEffect, useState } from 'react';
import { api, hasToken, type Plan } from '../lib/api.ts';

export type PlanSessionCostState = { sessionCost: PlanSessionCost | null; loading: boolean };

export function usePlanSessionCost(
  plan: Pick<Plan, 'id' | 'localPlanId' | 'updatedAt'> | undefined,
  enabled = true,
): PlanSessionCostState {
  const planId = plan ? (plan.localPlanId ?? plan.id) : undefined;
  const active = enabled && Boolean(planId) && hasToken();
  const updatedAt = plan?.updatedAt;
  const [state, setState] = useState<{ key: string; cost: PlanSessionCost | null }>({
    key: '',
    cost: null,
  });
  const key = JSON.stringify([planId, updatedAt]);
  useEffect(() => {
    if (!active || !planId) return;
    let cancelled = false;
    let requestId = 0;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      const id = ++requestId;
      api
        .getPlanSessionCost(planId)
        .then(({ sessionCost }) => {
          if (!cancelled && id === requestId) setState({ key, cost: sessionCost });
        })
        .catch(() => {
          if (!cancelled && id === requestId) setState({ key, cost: null });
        });
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    const timer = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [active, key, planId]);
  return {
    sessionCost: active && state.key === key ? state.cost : null,
    loading: active && state.key !== key,
  };
}
