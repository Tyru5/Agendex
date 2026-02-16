import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';

export function usePublishing() {
  const publishPlan = useMutation(api.plans.publishPlan);

  return {
    publish: async (plan: {
      id: string;
      agent: string;
      title: string;
      content: string;
      format: string;
      filePath?: string;
      workspace?: string;
      metadata?: Record<string, unknown>;
    }) => {
      return await publishPlan({
        localPlanId: plan.id,
        agent: plan.agent,
        title: plan.title,
        content: plan.content,
        format: plan.format,
        filePath: plan.filePath,
        workspace: plan.workspace,
        metadata: plan.metadata,
      });
    },
  };
}
