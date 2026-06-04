import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { deleteCommentWithAttachments, deletePendingUploadRecord } from './comments';

type PlanDeletionCtx = Pick<MutationCtx, 'db' | 'storage'>;

export async function deletePlanRelatedData(
  ctx: PlanDeletionCtx,
  {
    planId,
    ownerId,
  }: {
    planId: Id<'plans'>;
    ownerId: string;
  },
): Promise<void> {
  const shareLinks = await ctx.db
    .query('shareLinks')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of shareLinks) await ctx.db.delete(row._id);

  const comments = await ctx.db
    .query('comments')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const comment of comments) {
    await deleteCommentWithAttachments(ctx, comment);
  }

  const pendingUploads = await ctx.db
    .query('pendingUploads')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of pendingUploads) {
    await deletePendingUploadRecord(ctx, row);
  }

  const commentUploadReservations = await ctx.db
    .query('commentUploadReservations')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of commentUploadReservations) await ctx.db.delete(row._id);

  const planVersions = await ctx.db
    .query('planVersions')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of planVersions) await ctx.db.delete(row._id);

  const planAnnotations = await ctx.db
    .query('planAnnotations')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of planAnnotations) await ctx.db.delete(row._id);

  const planTags = await ctx.db
    .query('planTags')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of planTags) await ctx.db.delete(row._id);

  const collectionPlans = await ctx.db
    .query('collectionPlans')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of collectionPlans) await ctx.db.delete(row._id);

  const planPreferences = await ctx.db
    .query('planPreferences')
    .withIndex('by_owner_plan', (q) => q.eq('ownerId', ownerId).eq('planId', planId))
    .collect();
  for (const row of planPreferences) await ctx.db.delete(row._id);
}
