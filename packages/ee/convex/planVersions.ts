import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

export const listForPlan = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.PLAN_HISTORY);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const versions = await ctx.db
      .query('planVersions')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('desc')
      .collect();

    return versions.map((ver) => ({
      _id: ver._id,
      version: ver.version,
      title: ver.title,
      source: ver.source,
      createdAt: ver.createdAt,
    }));
  },
});

export const getVersion = query({
  args: { planId: v.id('plans'), version: v.number() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.PLAN_HISTORY);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const snapshot = await ctx.db
      .query('planVersions')
      .withIndex('by_plan_version', (q) => q.eq('planId', args.planId).eq('version', args.version))
      .first();

    if (!snapshot) {
      throw new ConvexError('Version not found');
    }

    return snapshot;
  },
});

export const restore = mutation({
  args: { planId: v.id('plans'), version: v.number() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.PLAN_HISTORY);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const snapshot = await ctx.db
      .query('planVersions')
      .withIndex('by_plan_version', (q) => q.eq('planId', args.planId).eq('version', args.version))
      .first();

    if (!snapshot) {
      throw new ConvexError('Version not found');
    }

    const newVersion = plan.version + 1;
    const now = Date.now();

    await ctx.db.patch(args.planId, {
      title: snapshot.title,
      content: snapshot.content,
      format: snapshot.format,
      filePath: snapshot.filePath,
      workspace: snapshot.workspace,
      metadata: snapshot.metadata,
      version: newVersion,
      updatedAt: now,
    });

    await ctx.db.insert('planVersions', {
      ownerId: user._id,
      planId: args.planId,
      version: newVersion,
      title: snapshot.title,
      content: snapshot.content,
      format: snapshot.format,
      filePath: snapshot.filePath,
      workspace: snapshot.workspace,
      metadata: snapshot.metadata,
      source: 'restore',
      createdAt: now,
    });
  },
});
