import { ProFeature } from '@agendex/shared/types';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { type QueryCtx, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { deletePlanRelatedData } from './planDeletion';
import {
  filterVisiblePlans,
  isVisiblePlan,
  metadataWithPlanValueAssessment,
} from './planVisibility';
import { hasActiveSubscriptionForUserId } from './subscriptions';

export const publishPlan = mutation({
  args: {
    localPlanId: v.string(),
    agent: v.string(),
    title: v.string(),
    content: v.string(),
    format: v.string(),
    filePath: v.optional(v.string()),
    workspace: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const ownerId = user._id;
    const now = Date.now();

    const metadata = metadataWithPlanValueAssessment(args.metadata, {
      title: args.title,
      content: args.content,
    });

    const existing = await ctx.db
      .query('plans')
      .withIndex('by_owner_localPlanId', (q) =>
        q.eq('ownerId', ownerId).eq('localPlanId', args.localPlanId),
      )
      .first();

    if (existing) {
      const newVersion = existing.version + 1;
      await ctx.db.patch(existing._id, {
        agent: args.agent,
        title: args.title,
        content: args.content,
        format: args.format,
        filePath: args.filePath,
        workspace: args.workspace,
        metadata,
        version: newVersion,
        updatedAt: now,
      });
      await ctx.db.insert('planVersions', {
        ownerId,
        planId: existing._id,
        version: newVersion,
        title: args.title,
        content: args.content,
        format: args.format,
        filePath: args.filePath,
        workspace: args.workspace,
        metadata,
        source: 'cli_sync',
        createdAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('plans', {
      ownerId,
      localPlanId: args.localPlanId,
      agent: args.agent,
      title: args.title,
      content: args.content,
      format: args.format,
      filePath: args.filePath,
      workspace: args.workspace,
      metadata,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Resolves whose plans `getMyPublishedPlans` returns: your own, unless you lack
// an active subscription but belong to a workspace whose owner has one — then
// you see that owner's plans. Preserves the pre-pagination branching exactly.
async function resolvePublishedPlansOwnerId(ctx: QueryCtx, userId: string): Promise<string> {
  const ownActive = await hasActiveSubscriptionForUserId(ctx, userId);
  if (ownActive) return userId;

  const membership = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_member', (q) => q.eq('memberId', userId))
    .first();
  if (membership) {
    const ownerActive = await hasActiveSubscriptionForUserId(ctx, membership.workspaceOwnerId);
    if (ownerActive) return membership.workspaceOwnerId;
  }
  return userId;
}

export const getMyPublishedPlans = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const ownerId = await resolvePublishedPlansOwnerId(ctx, user._id);

    // Paginate rather than `.collect()`: a single query must never read an
    // unbounded number of plans, nor exceed Convex's per-transaction read
    // limits as plan count/content grows (the byte limit binds well before the
    // doc limit, since each plan carries its full content). `useCloudPlans`
    // walks every page client-side, so full-set aggregation and search still
    // work. Post-filtering shrinks a page but leaves the cursor valid.
    const result = await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .order('desc')
      .paginate(args.paginationOpts);

    return { ...result, page: filterVisiblePlans(result.page) };
  },
});

export const getPlan = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      const membership = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace_member', (q) =>
          q.eq('workspaceOwnerId', plan.ownerId).eq('memberId', user._id),
        )
        .first();

      if (!membership) {
        throw new ConvexError('Access denied');
      }

      const ownerActive = await hasActiveSubscriptionForUserId(ctx, plan.ownerId);
      if (!ownerActive) {
        throw new ConvexError('Access denied');
      }
    }

    if (!isVisiblePlan(plan)) {
      throw new ConvexError('Plan not found');
    }

    return plan;
  },
});

export const getPlanByShareToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const shareLink = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!shareLink) {
      throw new ConvexError('Invalid or revoked share link');
    }

    const plan = await ctx.db.get(shareLink.planId);
    if (!plan || !isVisiblePlan(plan)) {
      throw new ConvexError('Plan not found');
    }

    if (shareLink.passwordHash) {
      return { passwordRequired: true as const };
    }

    return plan;
  },
});

export const renamePlan = mutation({
  args: {
    planId: v.id('plans'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError('Title cannot be empty');
    }

    if (plan.title === title) {
      return;
    }

    await ctx.db.patch(args.planId, {
      title,
      updatedAt: Date.now(),
    });
  },
});

export const updatePlanContent = mutation({
  args: {
    planId: v.id('plans'),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    if (plan.title === args.title && plan.content === args.content) {
      return;
    }

    const newVersion = plan.version + 1;
    const now = Date.now();
    const metadata = metadataWithPlanValueAssessment(plan.metadata, {
      title: args.title,
      content: args.content,
    });

    await ctx.db.patch(args.planId, {
      title: args.title,
      content: args.content,
      metadata,
      version: newVersion,
      updatedAt: now,
    });

    await ctx.db.insert('planVersions', {
      ownerId: user._id,
      planId: args.planId,
      version: newVersion,
      title: args.title,
      content: args.content,
      format: plan.format,
      filePath: plan.filePath,
      workspace: plan.workspace,
      metadata,
      source: 'editor',
      createdAt: now,
    });
  },
});

export const deletePlan = mutation({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    await deletePlanRelatedData(ctx, { planId: args.planId, ownerId: user._id });

    await ctx.db.delete(args.planId);
  },
});
