import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { collectionValidator } from './validators';

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

/**
 * Collection order: memberships added before positions existed come first in creation order,
 * then positioned memberships by position.
 */
function compareCollectionPlans(a: Doc<'collectionPlans'>, b: Doc<'collectionPlans'>): number {
  if (a.position === undefined || b.position === undefined) {
    if (a.position !== b.position) return a.position === undefined ? -1 : 1;
    return a._creationTime - b._creationTime;
  }
  return a.position - b.position || a._creationTime - b._creationTime;
}

async function listCollectionPlans(
  ctx: QueryCtx,
  ownerId: string,
  collectionId: Id<'collections'>,
): Promise<Doc<'collectionPlans'>[]> {
  const rows = await ctx.db
    .query('collectionPlans')
    .withIndex('by_owner_and_collection', (q) =>
      q.eq('ownerId', ownerId).eq('collectionId', collectionId),
    )
    .take(MAX_COLLECTION_MEMBERSHIPS);
  return rows.filter((row) => row.ownerId === ownerId).sort(compareCollectionPlans);
}

/**
 * Memberships in collection order, split into rows whose plan the owner can still list and rows
 * whose plan is gone or foreign. Only `listed` rows are visible to clients.
 */
async function loadCollectionOrder(
  ctx: QueryCtx,
  ownerId: string,
  collectionId: Id<'collections'>,
): Promise<{ listed: Doc<'collectionPlans'>[]; unlisted: Doc<'collectionPlans'>[] }> {
  const rows = await listCollectionPlans(ctx, ownerId, collectionId);
  const plans = await Promise.all(rows.map((row) => ctx.db.get(row.planId)));
  const listed: Doc<'collectionPlans'>[] = [];
  const unlisted: Doc<'collectionPlans'>[] = [];
  for (const [index, row] of rows.entries()) {
    (plans[index]?.ownerId === ownerId ? listed : unlisted).push(row);
  }
  return { listed, unlisted };
}

/** Rewrites positions to 0..n-1 in the given order, patching only rows whose position changes. */
async function writeCollectionOrder(ctx: MutationCtx, rows: readonly Doc<'collectionPlans'>[]) {
  for (const [position, row] of rows.entries()) {
    if (row.position !== position) await ctx.db.patch(row._id, { position });
  }
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

    const rows = await listCollectionPlans(ctx, user._id, args.collectionId);
    const existing = rows.find((row) => row.planId === args.planId);
    if (existing) return requireOwnedCollectionPlan(existing, user._id)._id;
    if (rows.length >= MAX_COLLECTION_MEMBERSHIPS) {
      throw new ConvexError(`Collections hold up to ${MAX_COLLECTION_MEMBERSHIPS} plans`);
    }

    // Legacy rows already sort first. Append after the largest stored position
    // without rewriting existing memberships (including gaps left by removals).
    const position = rows.reduce(
      (next, row) => Math.max(next, (row.position ?? -1) + 1),
      rows.length,
    );
    return await ctx.db.insert('collectionPlans', {
      ownerId: user._id,
      collectionId: args.collectionId,
      planId: args.planId,
      position,
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
        q.eq('ownerId', user._id).eq('collectionId', args.collectionId).eq('planId', args.planId),
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
      .withIndex('by_owner_and_plan', (q) => q.eq('ownerId', user._id).eq('planId', args.planId))
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

    const { listed } = await loadCollectionOrder(ctx, user._id, args.collectionId);
    return listed.map((row) => row.planId);
  },
});

/** Moves a plan to `toIndex` in the order returned by `getPlansInCollection`. */
export const moveCollectionPlan = mutation({
  args: { collectionId: v.id('collections'), planId: v.id('plans'), toIndex: v.number() },
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

    const { listed, unlisted } = await loadCollectionOrder(ctx, user._id, args.collectionId);
    const fromIndex = listed.findIndex((row) => row.planId === args.planId);
    const row = requireOwnedCollectionPlan(listed[fromIndex] ?? null, user._id);
    if (!Number.isInteger(args.toIndex) || args.toIndex < 0 || args.toIndex >= listed.length) {
      throw new ConvexError('Position out of range');
    }

    listed.splice(fromIndex, 1);
    listed.splice(args.toIndex, 0, row);
    await writeCollectionOrder(ctx, [...listed, ...unlisted]);
    return null;
  },
});
