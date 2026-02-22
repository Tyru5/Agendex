import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

export const getTagsForPlans = query({
  args: { planIds: v.array(v.id('plans')) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const result: Record<string, any[]> = {};

    for (const planId of args.planIds) {
      const planTagRows = await ctx.db
        .query('planTags')
        .withIndex('by_plan', (q: any) => q.eq('planId', planId))
        .collect();

      const tags = [];
      for (const pt of planTagRows) {
        const tag = await ctx.db.get(pt.tagId);
        if (tag) tags.push(tag);
      }
      result[planId] = tags;
    }

    return result;
  },
});

export const addTag = mutation({
  args: { planId: v.id('plans'), tagId: v.id('tags') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.ownerId !== user._id) throw new ConvexError('Plan not found');

    const existing = await ctx.db
      .query('planTags')
      .withIndex('by_plan_tag', (q: any) => q.eq('planId', args.planId).eq('tagId', args.tagId))
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert('planTags', {
      ownerId: user._id,
      planId: args.planId,
      tagId: args.tagId,
      createdAt: Date.now(),
    });
  },
});

export const removeTag = mutation({
  args: { planId: v.id('plans'), tagId: v.id('tags') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const row = await ctx.db
      .query('planTags')
      .withIndex('by_plan_tag', (q: any) => q.eq('planId', args.planId).eq('tagId', args.tagId))
      .first();

    if (!row) throw new ConvexError('Tag not assigned to plan');
    if (row.ownerId !== user._id) throw new ConvexError('Access denied');

    await ctx.db.delete(row._id);
  },
});

export const setTagsForPlan = mutation({
  args: { planId: v.id('plans'), tagIds: v.array(v.id('tags')) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.ownerId !== user._id) throw new ConvexError('Plan not found');

    const existing = await ctx.db
      .query('planTags')
      .withIndex('by_plan', (q: any) => q.eq('planId', args.planId))
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    for (const tagId of args.tagIds) {
      await ctx.db.insert('planTags', {
        ownerId: user._id,
        planId: args.planId,
        tagId,
        createdAt: Date.now(),
      });
    }
  },
});
