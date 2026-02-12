import { useState, useEffect, useCallback } from 'react';
import { api, type Plan, type AgentStats } from '../lib/api.ts';

export function usePlans(filters: { agent?: string; q?: string; sort?: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPlans(filters);
      setPlans(res.plans);
    } catch (e) {
      console.error('failed to fetch plans', e);
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [filters.agent, filters.q, filters.sort]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { plans, loading, error, refresh };
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentStats[]>([]);

  useEffect(() => {
    api.getAgents().then(setAgents).catch(console.error);
  }, []);

  return agents;
}
