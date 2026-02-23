import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import type { Plan } from '@agendex/app/src/client/lib/api.ts';

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
    // biome-ignore lint/suspicious/noExplicitAny: Convex query returns untyped documents
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
