import { useCloudPlanPublisher } from './useCloudPlanPublisher';

export function usePublishing() {
  const publishPlan = useCloudPlanPublisher();

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
