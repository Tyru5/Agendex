import { useCallback, useEffect, useRef, useState } from 'react';
import { type AgentStats, api, type Plan } from '../lib/api.ts';
import { seedSeen } from './useSeenPlans.ts';
import { useSocketEvent } from './useSocket.ts';

type PlanRefreshReason = 'manual' | 'realtime';

export function getPlanRefreshPresentation(
  hasLoaded: boolean,
  reason: PlanRefreshReason,
): { loading: boolean; refreshing: boolean } {
  return {
    loading: !hasLoaded,
    refreshing: hasLoaded && reason === 'manual',
  };
}

export function usePlans(
  filters: { agent?: string; q?: string; sort?: string },
  enabled = true,
  realtime = true,
) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const { agent, q, sort } = filters;

  const refreshPlans = useCallback(
    async (reason: PlanRefreshReason) => {
      if (!enabled) return;
      const presentation = getPlanRefreshPresentation(initialLoadDone.current, reason);
      if (presentation.refreshing) setRefreshing(true);
      if (presentation.loading) setLoading(true);
      setError(null);
      try {
        const res = await api.getPlans({ agent, q, sort });
        seedSeen(res.plans);
        setPlans(res.plans);
      } catch (e) {
        console.error('failed to fetch plans', e);
        setError(e instanceof Error ? e.message : 'unknown error');
      } finally {
        if (presentation.refreshing) setRefreshing(false);
        if (presentation.loading) {
          setLoading(false);
          initialLoadDone.current = true;
        }
      }
    },
    [agent, enabled, q, sort],
  );

  const refresh = useCallback(() => refreshPlans('manual'), [refreshPlans]);
  const refreshFromRealtime = useCallback(() => {
    void refreshPlans('realtime');
  }, [refreshPlans]);

  useEffect(() => {
    if (enabled) refresh();
  }, [refresh, enabled]);

  useSocketEvent('plan:updated', refreshFromRealtime, enabled && realtime);
  useSocketEvent('connection', refreshFromRealtime, enabled && realtime);

  return { plans, loading, refreshing, error, refresh };
}

export function useAgents(enabled = true, realtime = true) {
  const [agents, setAgents] = useState<AgentStats[]>([]);

  const refresh = useCallback(() => {
    if (!enabled) return;
    api.getAgents().then(setAgents).catch(console.error);
  }, [enabled]);

  useEffect(() => {
    if (enabled) refresh();
  }, [refresh, enabled]);

  useSocketEvent('plan:updated', refresh, enabled && realtime);
  useSocketEvent('connection', refresh, enabled && realtime);

  return agents;
}
