import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Plan } from '../lib/api.ts';

export function useCloudPlans(): {
  plans: Plan[];
  loading: boolean;
  error: string | null;
} {
  const result = useQuery(api.plans.getMyPublishedPlans);

  if (result === undefined) {
    return { plans: [], loading: true, error: null };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plans: Plan[] = result.map((p: any) => ({
      id: p._id,
      agent: p.agent,
      title: p.title,
      content: p.content,
      filePath: p.filePath ?? '',
      format: p.format,
      createdAt: new Date(p.createdAt).toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
      workspace: p.workspace,
      metadata: (p.metadata as Record<string, unknown>) ?? {},
    }));

    return { plans, loading: false, error: null };
  } catch (e) {
    return {
      plans: [],
      loading: false,
      error: e instanceof Error ? e.message : 'Failed to load cloud plans',
    };
  }
}
