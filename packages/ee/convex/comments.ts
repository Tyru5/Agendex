import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

async function validateShareToken(ctx: any, planId: string, token: string): Promise<void> {
  const shareLink = await ctx.db
    .query('shareLinks')
    .withIndex('by_token', (q: any) => q.eq('token', token))
    .first();

  if (!shareLink || shareLink.revokedAt || shareLink.planId !== planId) {
    throw new ConvexError('Invalid or revoked share token');
  }
}

export const getComments = query({
  args: { planId: v.id('plans'), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError('Plan not found');

    const user = await authComponent.safeGetAuthUser(ctx);
    const isOwner = user && plan.ownerId === user._id;

    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else {
      if (!args.token) throw new ConvexError('Share token required');
      await validateShareToken(ctx, args.planId, args.token);
    }

    return await ctx.db
      .query('comments')
      .withIndex('by_plan', (q: any) => q.eq('planId', args.planId))
      .order('asc')
      .collect();
  },
});

export const addComment = mutation({
  args: {
    planId: v.id('plans'),
    body: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else {
      if (!args.token) throw new ConvexError('Share token required');
      await validateShareToken(ctx, args.planId, args.token);
    }

    return await ctx.db.insert('comments', {
      planId: args.planId,
      authorId: user._id,
      authorName: user.name ?? 'Anonymous',
      authorAvatar: user.image ?? undefined,
      body: args.body,
      createdAt: Date.now(),
    });
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id('comments') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new ConvexError('Comment not found');
    }

    const plan = await ctx.db.get(comment.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else if (comment.authorId !== user._id) {
      throw new ConvexError('Access denied');
    }

    await ctx.db.delete(args.commentId);
  },
});
