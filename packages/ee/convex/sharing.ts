import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

export const createShareLink = mutation({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.SHARE_LINKS);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const token = `${crypto.randomUUID()}-${Date.now().toString(36)}`;

    await ctx.db.insert('shareLinks', {
      planId: args.planId,
      token,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    return token;
  },
});

export const revokeShareLink = mutation({
  args: { shareLinkId: v.id('shareLinks') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.SHARE_LINKS);

    const shareLink = await ctx.db.get(args.shareLinkId);
    if (!shareLink) {
      throw new ConvexError('Share link not found');
    }

    const plan = await ctx.db.get(shareLink.planId);
    if (!plan || plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    await ctx.db.patch(args.shareLinkId, {
      revokedAt: Date.now(),
    });
  },
});

export const getShareLinks = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.SHARE_LINKS);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    return await ctx.db
      .query('shareLinks')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .collect();
  },
});
