import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

export const listMyCollections = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    return await ctx.db
      .query('collections')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .collect();
  },
});

export const createCollection = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
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
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.ownerId !== user._id) {
      throw new ConvexError('Collection not found');
    }

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
  },
});

export const deleteCollection = mutation({
  args: { collectionId: v.id('collections') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.ownerId !== user._id) {
      throw new ConvexError('Collection not found');
    }

    await ctx.db.delete(args.collectionId);
    await ctx.scheduler.runAfter(0, internal.collections.cleanupCollectionPlans, {
      collectionId: args.collectionId,
    });
  },
});

export const cleanupCollectionPlans = internalMutation({
  args: { collectionId: v.id('collections') },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('collectionPlans')
      .withIndex('by_collection', (q) => q.eq('collectionId', args.collectionId))
      .take(500);

    for (const cp of batch) {
      await ctx.db.delete(cp._id);
    }

    if (batch.length === 500) {
      await ctx.scheduler.runAfter(0, internal.collections.cleanupCollectionPlans, {
        collectionId: args.collectionId,
      });
    }
  },
});

export const addPlanToCollection = mutation({
  args: { collectionId: v.id('collections'), planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.ownerId !== user._id) {
      throw new ConvexError('Collection not found');
    }

    const existing = await ctx.db
      .query('collectionPlans')
      .withIndex('by_collection_plan', (q) =>
        q.eq('collectionId', args.collectionId).eq('planId', args.planId),
      )
      .first();

    if (existing) return existing._id;

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
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const row = await ctx.db
      .query('collectionPlans')
      .withIndex('by_collection_plan', (q) =>
        q.eq('collectionId', args.collectionId).eq('planId', args.planId),
      )
      .first();

    if (!row) throw new ConvexError('Plan not in collection');
    if (row.ownerId !== user._id) throw new ConvexError('Access denied');

    await ctx.db.delete(row._id);
  },
});

export const getCollectionsForPlan = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const rows = await ctx.db
      .query('collectionPlans')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .collect();

    return rows.map((r) => r.collectionId);
  },
});

export const getPlansInCollection = query({
  args: { collectionId: v.id('collections') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.ownerId !== user._id) {
      throw new ConvexError('Collection not found');
    }

    const rows = await ctx.db
      .query('collectionPlans')
      .withIndex('by_collection', (q) => q.eq('collectionId', args.collectionId))
      .collect();

    return rows.map((r) => r.planId);
  },
});
