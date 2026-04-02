import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

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
        metadata: args.metadata,
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
        metadata: args.metadata,
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
      metadata: args.metadata,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getMyPublishedPlans = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .order('desc')
      .collect();
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
      throw new ConvexError('Access denied');
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
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (shareLink.passwordHash) {
      return { passwordRequired: true as const };
    }

    return plan;
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

    await ctx.db.patch(args.planId, {
      title: args.title,
      content: args.content,
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
      metadata: plan.metadata,
      source: 'editor',
      createdAt: now,
    });
  },
});
