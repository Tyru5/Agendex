import { type Infer, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';

export const sharedPlanDtoValidator = v.object({
  _id: v.id('plans'),
  agent: v.string(),
  title: v.string(),
  content: v.string(),
  format: v.string(),
  createdAt: v.number(),
});

export type SharedPlanDto = Infer<typeof sharedPlanDtoValidator>;

export function toSharedPlanDto(
  plan: Pick<Doc<'plans'>, '_id' | 'agent' | 'title' | 'content' | 'format' | 'createdAt'>,
): SharedPlanDto {
  return {
    _id: plan._id,
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    createdAt: plan.createdAt,
  };
}
