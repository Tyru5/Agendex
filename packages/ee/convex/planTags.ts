import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

export const MAX_PLANS_PER_TAG_QUERY = 100;
export const MAX_TAGS_PER_PLAN = 50;

const tagDocValidator = v.object({
  _id: v.id('tags'),
  _creationTime: v.number(),
  ownerId: v.string(),
  name: v.string(),
  nameLc: v.string(),
  color: v.optional(v.string()),
  createdAt: v.number(),
});

export function normalizeBoundedIds<T extends string>(
  ids: readonly T[],
  maxCount: number,
  resourceName: string,
): T[] {
  if (ids.length > maxCount) {
    throw new ConvexError(`Too many ${resourceName}; maximum is ${maxCount}`);
  }

  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function requireOwnedDocuments<T extends { ownerId: string }>(
  documents: readonly (T | null)[],
  ownerId: string,
  resourceName: 'Plan' | 'Tag',
): T[] {
  const ownedDocuments: T[] = [];
  for (const document of documents) {
    if (!document || document.ownerId !== ownerId) {
      throw new ConvexError(`${resourceName} not found`);
    }
    ownedDocuments.push(document);
  }
  return ownedDocuments;
}

export const getTagsForPlans = query({
  args: { planIds: v.array(v.id('plans')) },
  returns: v.record(v.id('plans'), v.array(tagDocValidator)),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const planIds = normalizeBoundedIds(
      args.planIds,
      MAX_PLANS_PER_TAG_QUERY,
      'plans in a tag query',
    );
    const plans = requireOwnedDocuments(
      await Promise.all(planIds.map((planId) => ctx.db.get(planId))),
      user._id,
      'Plan',
    );
    const ownerId = user._id;

    const rowsByPlan = await Promise.all(
      plans.map(async (plan) => {
        const rows = await ctx.db
          .query('planTags')
          .withIndex('by_owner_plan', (q) =>
            q.eq('ownerId', ownerId).eq('planId', plan._id),
          )
          .take(MAX_TAGS_PER_PLAN + 1);
        if (rows.length > MAX_TAGS_PER_PLAN) {
          throw new ConvexError(`A plan cannot have more than ${MAX_TAGS_PER_PLAN} tags`);
        }
        return rows;
      }),
    );
    const allPlanTagRows = rowsByPlan.flat();

    const uniqueTagIds = normalizeBoundedIds(
      allPlanTagRows.map((row) => row.tagId),
      MAX_PLANS_PER_TAG_QUERY * MAX_TAGS_PER_PLAN,
      'tag relations',
    );
    const tags = requireOwnedDocuments(
      await Promise.all(uniqueTagIds.map((tagId) => ctx.db.get(tagId))),
      ownerId,
      'Tag',
    );
    const tagMap = new Map(tags.map((tag) => [tag._id, tag] as const));

    const result = {} as Record<Id<'plans'>, Doc<'tags'>[]>;
    for (const planId of planIds) result[planId] = [];
    for (const row of allPlanTagRows) {
      const tag = tagMap.get(row.tagId);
      if (tag) result[row.planId]?.push(tag);
    }
    for (const planTags of Object.values(result)) {
      planTags.sort(
        (a, b) =>
          a.nameLc.localeCompare(b.nameLc) ||
          (a._id < b._id ? -1 : a._id > b._id ? 1 : 0),
      );
    }

    return result;
  },
});

export const addTag = mutation({
  args: { planId: v.id('plans'), tagId: v.id('tags') },
  returns: v.id('planTags'),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const [planDocument, tagDocument] = await Promise.all([
      ctx.db.get(args.planId),
      ctx.db.get(args.tagId),
    ]);
    const plan = requireOwnedDocuments([planDocument], user._id, 'Plan')[0];
    requireOwnedDocuments([tagDocument], plan.ownerId, 'Tag');

    const existing = await ctx.db
      .query('planTags')
      .withIndex('by_owner_plan_tag', (q) =>
        q.eq('ownerId', plan.ownerId).eq('planId', args.planId).eq('tagId', args.tagId),
      )
      .first();

    if (existing) return existing._id;
    const currentRows = await ctx.db
      .query('planTags')
      .withIndex('by_owner_plan', (q) =>
        q.eq('ownerId', plan.ownerId).eq('planId', args.planId),
      )
      .take(MAX_TAGS_PER_PLAN);
    if (currentRows.length >= MAX_TAGS_PER_PLAN) {
      throw new ConvexError(`A plan cannot have more than ${MAX_TAGS_PER_PLAN} tags`);
    }

    return await ctx.db.insert('planTags', {
      ownerId: plan.ownerId,
      planId: args.planId,
      tagId: args.tagId,
      createdAt: Date.now(),
    });
  },
});

export const removeTag = mutation({
  args: { planId: v.id('plans'), tagId: v.id('tags') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const plan = requireOwnedDocuments([await ctx.db.get(args.planId)], user._id, 'Plan')[0];
    requireOwnedDocuments([await ctx.db.get(args.tagId)], plan.ownerId, 'Tag');

    const row = await ctx.db
      .query('planTags')
      .withIndex('by_owner_plan_tag', (q) =>
        q.eq('ownerId', plan.ownerId).eq('planId', args.planId).eq('tagId', args.tagId),
      )
      .first();

    if (!row) throw new ConvexError('Tag not assigned to plan');

    await ctx.db.delete(row._id);
    return null;
  },
});

export const setTagsForPlan = mutation({
  args: { planId: v.id('plans'), tagIds: v.array(v.id('tags')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const tagIds = normalizeBoundedIds(args.tagIds, MAX_TAGS_PER_PLAN, 'tags for a plan');
    const plan = requireOwnedDocuments([await ctx.db.get(args.planId)], user._id, 'Plan')[0];
    requireOwnedDocuments(
      await Promise.all(tagIds.map((tagId) => ctx.db.get(tagId))),
      plan.ownerId,
      'Tag',
    );

    const existing = await ctx.db
      .query('planTags')
      .withIndex('by_owner_plan', (q) =>
        q.eq('ownerId', plan.ownerId).eq('planId', args.planId),
      )
      .take(MAX_TAGS_PER_PLAN + 1);
    if (existing.length > MAX_TAGS_PER_PLAN) {
      throw new ConvexError(`A plan cannot have more than ${MAX_TAGS_PER_PLAN} tags`);
    }

    const desiredTagIds = new Set(tagIds);
    const retainedTagIds = new Set<Id<'tags'>>();
    for (const row of existing) {
      if (!desiredTagIds.has(row.tagId) || retainedTagIds.has(row.tagId)) {
        await ctx.db.delete(row._id);
      } else {
        retainedTagIds.add(row.tagId);
      }
    }

    const createdAt = Date.now();
    for (const tagId of tagIds) {
      if (!retainedTagIds.has(tagId)) {
        await ctx.db.insert('planTags', {
          ownerId: plan.ownerId,
          planId: args.planId,
          tagId,
          createdAt,
        });
      }
    }

    return null;
  },
});
