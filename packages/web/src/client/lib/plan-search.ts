import type { Plan } from './api.ts';

export function filterPlans(plans: Plan[], query: string): Plan[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return plans;

  return plans.filter((plan) => {
    return (
      plan.title.toLowerCase().includes(normalizedQuery) ||
      plan.content.toLowerCase().includes(normalizedQuery) ||
      plan.agent.toLowerCase().includes(normalizedQuery) ||
      plan.workspace?.toLowerCase().includes(normalizedQuery) ||
      plan.filePath.toLowerCase().includes(normalizedQuery)
    );
  });
}
