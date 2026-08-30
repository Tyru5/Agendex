import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { deleteCommentWithAttachments, deletePendingUploadRecord } from './comments';

type PlanDeletionCtx = Pick<MutationCtx, 'db' | 'storage'>;

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

  if (phase === 'shareLinks') {
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

  const plannotatorWritebacks = await ctx.db
    .query('plannotatorWritebacks')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of plannotatorWritebacks) await ctx.db.delete(row._id);

  const planTags = await ctx.db
    .query('planTags')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of planTags) await ctx.db.delete(row._id);

  const planLinks = await ctx.db
    .query('planLinks')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .collect();
  for (const row of planLinks) await ctx.db.delete(row._id);

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
