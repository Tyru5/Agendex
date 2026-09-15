import { useCloudPlanPublisher } from './useCloudPlanPublisher';
import { toPlanMetadataDto } from '../../convex/planMetadata';

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
        metadata: toPlanMetadataDto(plan.metadata),
        filePath: plan.filePath,
        workspace: plan.workspace,
      });
    },
  };
}
