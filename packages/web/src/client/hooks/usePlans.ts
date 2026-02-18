import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Plan, type AgentStats } from '../lib/api.ts';
import { useSocketEvent } from './useSocket.ts';
import { seedSeen } from './useSeenPlans.ts';

export function usePlans(filters: { agent?: string; q?: string; sort?: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPlans(filtersRef.current);
      seedSeen(res.plans);
      setPlans(res.plans);
    } catch (e) {
      console.error('failed to fetch plans', e);
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [filters.agent, filters.q, filters.sort]);

  useSocketEvent('plan:updated', refresh);

  return { plans, loading, error, refresh };
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentStats[]>([]);

  const refresh = useCallback(() => {
    api.getAgents().then(setAgents).catch(console.error);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useSocketEvent('plan:updated', refresh);

  return agents;
}
