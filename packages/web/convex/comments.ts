import { ConvexError, v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { authComponent } from './auth';

export const getComments = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError('Plan not found');

    const user = await authComponent.safeGetAuthUser(ctx);
    const isOwner = user && plan.ownerId === user._id;

    if (!isOwner) {
      const activeShareLink = await ctx.db
        .query('shareLinks')
        .withIndex('by_plan', (q) => q.eq('planId', args.planId))
        .filter((q) => q.eq(q.field('revokedAt'), undefined))
        .first();
      if (!activeShareLink) throw new ConvexError('Access denied');
    }

    return await ctx.db
      .query('comments')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('asc')
      .collect();
  },
});

export const addComment = mutation({
  args: {
    planId: v.id('plans'),
    body: v.string(),
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

    if (comment.authorId !== user._id && plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    await ctx.db.delete(args.commentId);
  },
});
