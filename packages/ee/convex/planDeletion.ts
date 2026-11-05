import { v } from 'convex/values';
import { deleteFilePlanMentions } from './filePlanMentionIndex';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalMutation, type MutationCtx } from './_generated/server';
import { deleteCommentWithAttachments, deletePendingUploadRecord } from './comments';

type PlanDeletionCtx = Pick<MutationCtx, 'db' | 'storage' | 'scheduler'>;

export const PLAN_DELETION_PHASES = [
  'shareLinks',
  'comments',
  'pendingUploads',
  'commentUploadReservations',
  'planVersions',
  'planAnnotations',
  'plannotatorWritebacks',
  'planTags',
  'planLinks',
  'collectionPlans',
  'planPreferences',
  'planReviewRequests',
  'filePlanMentions',
] as const;

export type PlanDeletionPhase = (typeof PLAN_DELETION_PHASES)[number];

export function nextPlanDeletionPhase(phase: PlanDeletionPhase): PlanDeletionPhase | null {
  const index = PLAN_DELETION_PHASES.indexOf(phase);
  return PLAN_DELETION_PHASES[index + 1] ?? null;
}

export function planDeletionPhaseAfterBatch(
  phase: PlanDeletionPhase,
  deletedCount: number,
): PlanDeletionPhase | null {
  return deletedCount > 0 ? phase : nextPlanDeletionPhase(phase);
}

export async function deletePlanRelatedDataBatch(
  ctx: PlanDeletionCtx,
  {
    planId,
    phase,
    batchSize,
  }: {
    planId: Id<'plans'>;
    phase: PlanDeletionPhase;
    batchSize: number;
  },
): Promise<{ deleted: number; nextPhase: PlanDeletionPhase | null }> {
  let deleted = 0;

  if (phase === 'filePlanMentions') {
    const rows = await ctx.db
      .query('filePlanMentions')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'shareLinks') {
    const rows = await ctx.db
      .query('shareLinks')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'comments') {
    const rows = await ctx.db
      .query('comments')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const comment of rows) await deleteCommentWithAttachments(ctx, comment);
    deleted = rows.length;
  } else if (phase === 'pendingUploads') {
    const rows = await ctx.db
      .query('pendingUploads')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await deletePendingUploadRecord(ctx, row);
    deleted = rows.length;
  } else if (phase === 'commentUploadReservations') {
    const rows = await ctx.db
      .query('commentUploadReservations')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'planVersions') {
    const rows = await ctx.db
      .query('planVersions')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'planAnnotations') {
    const rows = await ctx.db
      .query('planAnnotations')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'plannotatorWritebacks') {
    const rows = await ctx.db
      .query('plannotatorWritebacks')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'planTags') {
    const rows = await ctx.db
      .query('planTags')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'planLinks') {
    const rows = await ctx.db
      .query('planLinks')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'collectionPlans') {
    const rows = await ctx.db
      .query('collectionPlans')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else if (phase === 'planReviewRequests') {
    const rows = await ctx.db
      .query('planReviewRequests')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  } else {
    const rows = await ctx.db
      .query('planPreferences')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted = rows.length;
  }

  return {
    deleted,
    nextPhase: planDeletionPhaseAfterBatch(phase, deleted),
  };
}

/** Rows per phase removed inside the caller's transaction; typical plans finish here. */
const INLINE_PLAN_CLEANUP_BATCH_SIZE = 25;
/** Rows per scheduled continuation batch for plans with large related data. */
const PLAN_CLEANUP_CONTINUATION_BATCH_SIZE = 100;

const planDeletionPhaseValidator = v.union(
  ...PLAN_DELETION_PHASES.map((phase) => v.literal(phase)),
);

/**
 * Bounded plan-related cleanup. Call before deleting the plan row in the same
 * mutation: the file-mention duplicate group must be reconciled while the plan
 * still exists. Each phase gets one bounded inline batch; any phase that may
 * have more rows is drained by a self-rescheduling continuation that runs only
 * after the plan row is gone.
 */
export async function deletePlanRelatedData(
  ctx: PlanDeletionCtx,
  { planId }: { planId: Id<'plans'> },
): Promise<void> {
  await deleteFilePlanMentions(ctx, planId);

  let continueFrom: PlanDeletionPhase | null = null;
  for (const phase of PLAN_DELETION_PHASES) {
    const { deleted } = await deletePlanRelatedDataBatch(ctx, {
      planId,
      phase,
      batchSize: INLINE_PLAN_CLEANUP_BATCH_SIZE,
    });
    if (continueFrom === null && deleted >= INLINE_PLAN_CLEANUP_BATCH_SIZE) {
      continueFrom = phase;
    }
  }

  if (continueFrom !== null) {
    await ctx.scheduler.runAfter(0, internal.planDeletion.continuePlanRelatedDataCleanup, {
      planId,
      phase: continueFrom,
    });
  }
}

export const continuePlanRelatedDataCleanup = internalMutation({
  args: { planId: v.id('plans'), phase: planDeletionPhaseValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Never strip related data from a plan that still exists.
    if (await ctx.db.get(args.planId)) return null;

    const { nextPhase } = await deletePlanRelatedDataBatch(ctx, {
      planId: args.planId,
      phase: args.phase,
      batchSize: PLAN_CLEANUP_CONTINUATION_BATCH_SIZE,
    });
    if (nextPhase) {
      await ctx.scheduler.runAfter(0, internal.planDeletion.continuePlanRelatedDataCleanup, {
        planId: args.planId,
        phase: nextPhase,
      });
    }
    return null;
  },
});
