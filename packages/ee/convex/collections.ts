import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

const collectionValidator = v.object({
  _id: v.id('collections'),
  _creationTime: v.number(),
  ownerId: v.string(),
  name: v.string(),
  nameLc: v.string(),
  description: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const MAX_COLLECTION_RESULTS = 1000;
const MAX_COLLECTION_MEMBERSHIPS = 1000;

function requireOwnedCollection(
  collection: Doc<'collections'> | null,
  ownerId: string,
): Doc<'collections'> {
  if (!collection || collection.ownerId !== ownerId) {
    throw new ConvexError('Collection not found');
  }
  return collection;
}

function requireOwnedPlan(plan: Doc<'plans'> | null, ownerId: string): Doc<'plans'> {
  if (!plan || plan.ownerId !== ownerId) {
    throw new ConvexError('Plan not found');
  }
  return plan;
}

function requireOwnedCollectionPlan(
  collectionPlan: Doc<'collectionPlans'> | null,
  ownerId: string,
): Doc<'collectionPlans'> {
  if (!collectionPlan || collectionPlan.ownerId !== ownerId) {
    throw new ConvexError('Plan not in collection');
  }
  return collectionPlan;
}

export const listMyCollections = query({
  args: {},
  returns: v.array(collectionValidator),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    return await ctx.db
      .query('collections')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .take(MAX_COLLECTION_RESULTS);
  },
});

export const createCollection = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  returns: v.id('collections'),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const nameLc = args.name.trim().toLowerCase();
    if (!nameLc) throw new ConvexError('Collection name cannot be empty');

    const existing = await ctx.db
      .query('collections')
      .withIndex('by_owner_nameLc', (q) => q.eq('ownerId', user._id).eq('nameLc', nameLc))
      .first();

    if (existing) throw new ConvexError('A collection with this name already exists');

    const now = Date.now();
    return await ctx.db.insert('collections', {
      ownerId: user._id,
      name: args.name.trim(),
      nameLc,
      description: args.description,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const renameCollection = mutation({
  args: { collectionId: v.id('collections'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    requireOwnedCollection(await ctx.db.get(args.collectionId), user._id);

    const nameLc = args.name.trim().toLowerCase();
    if (!nameLc) throw new ConvexError('Collection name cannot be empty');

    const existing = await ctx.db
      .query('collections')
      .withIndex('by_owner_nameLc', (q) => q.eq('ownerId', user._id).eq('nameLc', nameLc))
      .first();

    if (existing && existing._id !== args.collectionId) {
      throw new ConvexError('A collection with this name already exists');
    }

    await ctx.db.patch(args.collectionId, {
      name: args.name.trim(),
      nameLc,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteCollection = mutation({
  args: { collectionId: v.id('collections') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    requireOwnedCollection(await ctx.db.get(args.collectionId), user._id);

    await ctx.db.delete(args.collectionId);
    await ctx.scheduler.runAfter(0, internal.collections.cleanupCollectionPlans, {
      collectionId: args.collectionId,
      ownerId: user._id,
    });
    return null;
  },
});

export const cleanupCollectionPlans = internalMutation({
  args: { collectionId: v.id('collections'), ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('collectionPlans')
      .withIndex('by_owner_and_collection', (q) =>
        q.eq('ownerId', args.ownerId).eq('collectionId', args.collectionId),
      )
      .take(500);

    for (const collectionPlan of batch) {
      if (collectionPlan.ownerId === args.ownerId) {
        await ctx.db.delete(collectionPlan._id);
      }
    }

    if (batch.length === 500) {
      await ctx.scheduler.runAfter(0, internal.collections.cleanupCollectionPlans, args);
    }
    return null;
  },
});

export const addPlanToCollection = mutation({
  args: { collectionId: v.id('collections'), planId: v.id('plans') },
  returns: v.id('collectionPlans'),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const [collection, plan] = await Promise.all([
      ctx.db.get(args.collectionId),
      ctx.db.get(args.planId),
    ]);
    requireOwnedCollection(collection, user._id);
    requireOwnedPlan(plan, user._id);

    const existing = await ctx.db
      .query('collectionPlans')
      .withIndex('by_owner_and_collection_and_plan', (q) =>
        q
          .eq('ownerId', user._id)
          .eq('collectionId', args.collectionId)
          .eq('planId', args.planId),
      )
      .first();

    if (existing) return requireOwnedCollectionPlan(existing, user._id)._id;

    return await ctx.db.insert('collectionPlans', {
      ownerId: user._id,
      collectionId: args.collectionId,
      planId: args.planId,
      createdAt: Date.now(),
    });
  },
});

export const removePlanFromCollection = mutation({
  args: { collectionId: v.id('collections'), planId: v.id('plans') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const [collection, plan] = await Promise.all([
      ctx.db.get(args.collectionId),
      ctx.db.get(args.planId),
    ]);
    requireOwnedCollection(collection, user._id);
    requireOwnedPlan(plan, user._id);

    const row = await ctx.db
      .query('collectionPlans')
      .withIndex('by_owner_and_collection_and_plan', (q) =>
        q
          .eq('ownerId', user._id)
          .eq('collectionId', args.collectionId)
          .eq('planId', args.planId),
      )
      .first();

    await ctx.db.delete(requireOwnedCollectionPlan(row, user._id)._id);
    return null;
  },
});

export const getCollectionsForPlan = query({
  args: { planId: v.id('plans') },
  returns: v.array(v.id('collections')),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);
    requireOwnedPlan(await ctx.db.get(args.planId), user._id);

    const rows = await ctx.db
      .query('collectionPlans')
      .withIndex('by_owner_and_plan', (q) =>
        q.eq('ownerId', user._id).eq('planId', args.planId),
      )
      .take(MAX_COLLECTION_MEMBERSHIPS);
    const collections = await Promise.all(rows.map((row) => ctx.db.get(row.collectionId)));
    const collectionIds: Id<'collections'>[] = [];

    for (const [index, row] of rows.entries()) {
      const collection = collections[index];
      if (row.ownerId === user._id && collection?.ownerId === user._id) {
        collectionIds.push(collection._id);
      }
    }

    return collectionIds;
  },
});

export const getPlansInCollection = query({
  args: { collectionId: v.id('collections') },
  returns: v.array(v.id('plans')),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);
    requireOwnedCollection(await ctx.db.get(args.collectionId), user._id);

    const rows = await ctx.db
      .query('collectionPlans')
      .withIndex('by_owner_and_collection', (q) =>
        q.eq('ownerId', user._id).eq('collectionId', args.collectionId),
      )
      .take(MAX_COLLECTION_MEMBERSHIPS);
    const plans = await Promise.all(rows.map((row) => ctx.db.get(row.planId)));
    const planIds: Id<'plans'>[] = [];

    for (const [index, row] of rows.entries()) {
      const plan = plans[index];
      if (row.ownerId === user._id && plan?.ownerId === user._id) {
        planIds.push(plan._id);
      }
    }

    return planIds;
  },
});
