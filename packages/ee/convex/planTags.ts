import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

export const getTagsForPlans = query({
  args: { planIds: v.array(v.id('plans')) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const allPlanTagRows = (
      await Promise.all(
        args.planIds.map((planId) =>
          ctx.db
            .query('planTags')
            .withIndex('by_plan', (q) => q.eq('planId', planId))
            .collect(),
        ),
      )
    ).flat();

    const uniqueTagIds = [...new Set(allPlanTagRows.map((r) => r.tagId))];
    const tagDocs = await Promise.all(uniqueTagIds.map((id) => ctx.db.get(id)));
    const tagMap = new Map(
      uniqueTagIds.map((id, i) => [id, tagDocs[i]] as const).filter(([, doc]) => doc),
    );

    const result: Record<string, Doc<'tags'>[]> = {};
    for (const planId of args.planIds) result[planId] = [];
    for (const row of allPlanTagRows) {
      const tag = tagMap.get(row.tagId);
      if (tag) result[row.planId]?.push(tag);
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
      .withIndex('by_plan_tag', (q) => q.eq('planId', args.planId).eq('tagId', args.tagId))
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
      .withIndex('by_plan_tag', (q) => q.eq('planId', args.planId).eq('tagId', args.tagId))
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
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .collect();

    const currentTagIds = new Set(existing.map((r) => r.tagId));
    const desiredTagIds = new Set(args.tagIds);

    for (const row of existing) {
      if (!desiredTagIds.has(row.tagId)) await ctx.db.delete(row._id);
    }

    for (const tagId of args.tagIds) {
      if (!currentTagIds.has(tagId)) {
        await ctx.db.insert('planTags', {
          ownerId: user._id,
          planId: args.planId,
          tagId,
          createdAt: Date.now(),
        });
      }
    }
  },
});
