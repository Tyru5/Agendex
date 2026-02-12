import { useState, useEffect, useCallback } from "react";
import { api, type Plan, type AgentStats } from "../lib/api.ts";

export function usePlans(filters: { agent?: string; q?: string; sort?: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPlans(filters);
      setPlans(res.plans);
    } catch (e) {
      console.error("failed to fetch plans", e);
    } finally {
      setLoading(false);
    }
  }, [filters.agent, filters.q, filters.sort]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { plans, loading, refresh };
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentStats[]>([]);

  useEffect(() => {
    api.getAgents().then(setAgents).catch(console.error);
  }, []);

  return agents;
}
