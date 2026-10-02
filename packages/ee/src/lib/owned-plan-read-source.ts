import type { Plan, PlanReadSource } from '@agendex/web';

export function publishedCloudPlan(plan: {
  _id: string;
  ownerId: string;
  localPlanId?: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath?: string;
  workspace?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}): Plan {
  return {
    id: plan._id,
    ownerId: plan.ownerId,
    localPlanId: plan.localPlanId,
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    filePath: plan.filePath ?? '',
    createdAt: new Date(plan.createdAt).toISOString(),
    updatedAt: new Date(plan.updatedAt).toISOString(),
    workspace: plan.workspace,
    metadata: plan.metadata ?? {},
    contentLoaded: true,
  };
}

export function ownedPlanReadSource(
  userId: string | undefined,
  open: PlanReadSource['open'],
  clear: PlanReadSource['clear'],
): PlanReadSource {
  return {
    scope: `cloud:${userId ?? 'pending'}`,
    canRead: (plan) => Boolean(userId && plan.ownerId === userId),
    open,
    clear,
  };
}
