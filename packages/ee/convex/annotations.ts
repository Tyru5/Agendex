import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { type MutationCtx, mutation, type QueryCtx, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature, requireFeatureForUserId } from './entitlements';
import { planAnnotationValidator } from './validators';

const annotationType = v.union(
  v.literal('comment'),
  v.literal('replacement'),
  v.literal('deletion'),
  v.literal('insertion'),
  v.literal('global_comment'),
);

const annotationStatus = v.union(
  v.literal('draft'),
  v.literal('open'),
  v.literal('submitted'),
  v.literal('resolved'),
);

const planTextAnchor = v.object({
  quote: v.optional(v.string()),
  startOffset: v.optional(v.number()),
  endOffset: v.optional(v.number()),
  occurrenceIndex: v.optional(v.number()),
  prefix: v.optional(v.string()),
  suffix: v.optional(v.string()),
  contentHash: v.optional(v.string()),
});

type PlanReadCtx = QueryCtx;
type PlanWriteCtx = MutationCtx;

type AuthUser = {
  _id: string;
  name?: string | null;
};

async function requirePlanReadAccess(
  ctx: PlanReadCtx,
  planId: Id<'plans'>,
): Promise<{ user: AuthUser; isOwner: boolean }> {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new ConvexError('Unauthenticated');

  const plan = await ctx.db.get(planId);
  if (!plan) throw new ConvexError('Plan not found');

  if (plan.ownerId === user._id) {
    await requireFeature(ctx, ProFeature.PLANNOTATOR_INTEGRATION);
    return { user, isOwner: true };
  }

  const membership = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_workspace_member', (q) =>
      q.eq('workspaceOwnerId', plan.ownerId).eq('memberId', user._id),
    )
    .first();

  if (!membership) throw new ConvexError('Access denied');

  await requireFeatureForUserId(ctx, plan.ownerId, ProFeature.PLANNOTATOR_INTEGRATION);

  return { user, isOwner: false };
}

async function requirePlanOwnerWriteAccess(
  ctx: PlanWriteCtx,
  planId: Id<'plans'>,
): Promise<AuthUser> {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new ConvexError('Unauthenticated');

  await requireFeature(ctx, ProFeature.PLANNOTATOR_INTEGRATION);

  const plan = await ctx.db.get(planId);
  if (!plan) throw new ConvexError('Plan not found');
  if (plan.ownerId !== user._id) throw new ConvexError('Access denied');

  return user;
}

function validateAnnotationInput(args: {
  type: 'comment' | 'replacement' | 'deletion' | 'insertion' | 'global_comment';
  body?: string;
  replacementText?: string;
  anchor: { quote?: string };
}): { body?: string; replacementText?: string } {
  const body = args.body?.trim() || undefined;
  const replacementText = args.replacementText?.trim() || undefined;
  const quote = args.anchor.quote?.trim();

  if (args.type !== 'global_comment' && !quote) {
    throw new ConvexError('Selected text is required for inline annotations');
  }

  if ((args.type === 'comment' || args.type === 'global_comment') && !body) {
    throw new ConvexError('Annotation feedback is required');
  }

  if ((args.type === 'replacement' || args.type === 'insertion') && !replacementText) {
    throw new ConvexError('Suggested replacement text is required');
  }

  return { body, replacementText };
}

export const listForPlan = query({
  args: { planId: v.id('plans') },
  returns: v.array(planAnnotationValidator),
  handler: async (ctx, args) => {
    await requirePlanReadAccess(ctx, args.planId);

    return await ctx.db
      .query('planAnnotations')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('asc')
      .collect();
  },
});

export const createAnnotation = mutation({
  args: {
    planId: v.id('plans'),
    type: annotationType,
    status: v.optional(annotationStatus),
    body: v.optional(v.string()),
    replacementText: v.optional(v.string()),
    anchor: planTextAnchor,
    source: v.optional(v.string()),
  },
  returns: v.id('planAnnotations'),
  handler: async (ctx, args) => {
    const user = await requirePlanOwnerWriteAccess(ctx, args.planId);
    if (args.status === 'submitted') {
      throw new ConvexError('Use a write-back to submit annotations');
    }
    const validated = validateAnnotationInput(args);
    const now = Date.now();

    return await ctx.db.insert('planAnnotations', {
      planId: args.planId,
      authorId: user._id,
      authorName: user.name ?? 'Anonymous',
      source: args.source ?? 'agendex-cloud',
      type: args.type,
      status: args.status ?? 'open',
      body: validated.body,
      replacementText: validated.replacementText,
      anchor: args.anchor,
      createdAt: now,
      updatedAt: now,
      resolvedAt: args.status === 'resolved' ? now : undefined,
    });
  },
});

export const updateAnnotation = mutation({
  args: {
    annotationId: v.id('planAnnotations'),
    body: v.optional(v.string()),
    replacementText: v.optional(v.string()),
    status: v.optional(annotationStatus),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const annotation = await ctx.db.get(args.annotationId);
    if (!annotation) throw new ConvexError('Annotation not found');

    await requirePlanOwnerWriteAccess(ctx, annotation.planId);

    const now = Date.now();
    const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...nextAnnotation } = annotation;
    nextAnnotation.updatedAt = now;

    if (args.body !== undefined) nextAnnotation.body = args.body.trim();
    if (args.replacementText !== undefined)
      nextAnnotation.replacementText = args.replacementText.trim();
    if (args.status !== undefined) {
      if (args.status === 'submitted') {
        throw new ConvexError('Use a write-back to submit annotations');
      }
      nextAnnotation.status = args.status;
    }

    if (args.status === 'resolved') {
      nextAnnotation.resolvedAt = now;
    } else if (nextAnnotation.status !== 'resolved') {
      delete nextAnnotation.resolvedAt;
    }

    await ctx.db.replace(args.annotationId, nextAnnotation);
    return null;
  },
});

export const markSubmitted = mutation({
  args: {
    annotationIds: v.array(v.id('planAnnotations')),
    writebackId: v.id('plannotatorWritebacks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const writeback = await ctx.db.get(args.writebackId);
    if (!writeback) throw new ConvexError('Write-back not found');
    if (writeback.status !== 'pending' || writeback.expiresAt <= now) {
      throw new ConvexError('Write-back is not pending');
    }

    const user = await requirePlanOwnerWriteAccess(ctx, writeback.planId);
    if (writeback.ownerId !== user._id) throw new ConvexError('Access denied');

    const annotationIds = [...new Set(args.annotationIds)];
    const writebackAnnotationIds = new Set(writeback.annotationIds ?? []);
    const nextWritebackAnnotationIds = [...(writeback.annotationIds ?? [])];
    for (const annotationId of annotationIds) {
      const annotation = await ctx.db.get(annotationId);
      if (
        !annotation ||
        annotation.planId !== writeback.planId ||
        annotation.authorId !== user._id
      ) {
        throw new ConvexError('Annotation does not belong to this write-back');
      }
      if (annotation.status !== 'open') {
        throw new ConvexError('Only open annotations can be submitted');
      }
      if (!writebackAnnotationIds.has(annotationId)) {
        writebackAnnotationIds.add(annotationId);
        nextWritebackAnnotationIds.push(annotationId);
      }
    }

    if (nextWritebackAnnotationIds.length !== (writeback.annotationIds ?? []).length) {
      await ctx.db.patch(args.writebackId, {
        annotationIds: nextWritebackAnnotationIds,
        updatedAt: now,
      });
    }

    for (const annotationId of annotationIds) {
      await ctx.db.patch(annotationId, {
        status: 'submitted',
        submittedAt: now,
        updatedAt: now,
        writebackId: args.writebackId,
      });
    }
    return null;
  },
});

export const deleteAnnotation = mutation({
  args: { annotationId: v.id('planAnnotations') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const annotation = await ctx.db.get(args.annotationId);
    if (!annotation) throw new ConvexError('Annotation not found');

    await requirePlanOwnerWriteAccess(ctx, annotation.planId);
    await ctx.db.delete(args.annotationId);
    return null;
  },
});
