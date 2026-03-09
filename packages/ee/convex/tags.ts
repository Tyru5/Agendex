import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

export const listMyTags = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    return await ctx.db
      .query('tags')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .collect();
  },
});

export const createTag = mutation({
  args: { name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const nameLc = args.name.trim().toLowerCase();
    if (!nameLc) throw new ConvexError('Tag name cannot be empty');

    const existing = await ctx.db
      .query('tags')
      .withIndex('by_owner_nameLc', (q) => q.eq('ownerId', user._id).eq('nameLc', nameLc))
      .first();

    if (existing) throw new ConvexError('A tag with this name already exists');

    return await ctx.db.insert('tags', {
      ownerId: user._id,
      name: args.name.trim(),
      nameLc,
      color: args.color,
      createdAt: Date.now(),
    });
  },
});

export const renameTag = mutation({
  args: { tagId: v.id('tags'), name: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const tag = await ctx.db.get(args.tagId);
    if (!tag || tag.ownerId !== user._id) throw new ConvexError('Tag not found');

    const nameLc = args.name.trim().toLowerCase();
    if (!nameLc) throw new ConvexError('Tag name cannot be empty');

    const existing = await ctx.db
      .query('tags')
      .withIndex('by_owner_nameLc', (q) => q.eq('ownerId', user._id).eq('nameLc', nameLc))
      .first();

    if (existing && existing._id !== args.tagId) {
      throw new ConvexError('A tag with this name already exists');
    }

    await ctx.db.patch(args.tagId, { name: args.name.trim(), nameLc });
  },
});

export const deleteTag = mutation({
  args: { tagId: v.id('tags') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const tag = await ctx.db.get(args.tagId);
    if (!tag || tag.ownerId !== user._id) throw new ConvexError('Tag not found');

    await ctx.db.delete(args.tagId);
    await ctx.scheduler.runAfter(0, internal.tags.cleanupPlanTags, { tagId: args.tagId });
  },
});

export const cleanupPlanTags = internalMutation({
  args: { tagId: v.id('tags') },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('planTags')
      .withIndex('by_tag', (q) => q.eq('tagId', args.tagId))
      .take(500);

    for (const pt of batch) {
      await ctx.db.delete(pt._id);
    }

    if (batch.length === 500) {
      await ctx.scheduler.runAfter(0, internal.tags.cleanupPlanTags, { tagId: args.tagId });
    }
  },
});
