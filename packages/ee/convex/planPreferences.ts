import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { type MutationCtx, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { planPreferenceValidator } from './validators';

async function getOwnedPlanOrThrow(
  ctx: Pick<MutationCtx, 'db'>,
  ownerId: string,
  planId: Id<'plans'>,
) {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.ownerId !== ownerId) {
    throw new ConvexError('Plan not found');
  }
  return plan;
}

export const listForMyPlans = query({
  args: {},
  returns: v.array(planPreferenceValidator),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query('planPreferences')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .collect();
  },
});

export const setPinned = mutation({
  args: { planId: v.id('plans'), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await getOwnedPlanOrThrow(ctx, user._id, args.planId);

    const existing = await ctx.db
      .query('planPreferences')
      .withIndex('by_owner_plan', (q) => q.eq('ownerId', user._id).eq('planId', args.planId))
      .first();
    const now = Date.now();

    if (!args.pinned) {
      if (!existing) return null;
      if (existing.lastSeenUpdatedAt === undefined) {
        await ctx.db.delete(existing._id);
        return null;
      }
      await ctx.db.patch(existing._id, { pinned: false, updatedAt: now });
      return null;
    }

    if (existing) {
      if (existing.pinned) return null;
      await ctx.db.patch(existing._id, { pinned: true, updatedAt: now });
      return null;
    }

    await ctx.db.insert('planPreferences', {
      ownerId: user._id,
      planId: args.planId,
      pinned: true,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markSeen = mutation({
  args: { planId: v.id('plans') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const plan = await getOwnedPlanOrThrow(ctx, user._id, args.planId);
    const existing = await ctx.db
      .query('planPreferences')
      .withIndex('by_owner_plan', (q) => q.eq('ownerId', user._id).eq('planId', args.planId))
      .first();
    const now = Date.now();

    if (existing) {
      if (existing.lastSeenUpdatedAt === plan.updatedAt) return null;
      await ctx.db.patch(existing._id, {
        lastSeenUpdatedAt: plan.updatedAt,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.insert('planPreferences', {
      ownerId: user._id,
      planId: args.planId,
      pinned: false,
      lastSeenUpdatedAt: plan.updatedAt,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markUnseen = mutation({
  args: { planId: v.id('plans') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await getOwnedPlanOrThrow(ctx, user._id, args.planId);

    const existing = await ctx.db
      .query('planPreferences')
      .withIndex('by_owner_plan', (q) => q.eq('ownerId', user._id).eq('planId', args.planId))
      .first();

    if (!existing) {
      const now = Date.now();
      await ctx.db.insert('planPreferences', {
        ownerId: user._id,
        planId: args.planId,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      });
      return null;
    }

    if (existing.lastSeenUpdatedAt === undefined) return null;
    if (!existing.pinned) {
      await ctx.db.delete(existing._id);
      return null;
    }

    await ctx.db.patch(existing._id, {
      lastSeenUpdatedAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markManySeen = mutation({
  args: { planIds: v.array(v.id('plans')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    if (args.planIds.length === 0) return null;

    const uniquePlanIds = [...new Set(args.planIds)];
    const [plans, existingPreferences] = await Promise.all([
      Promise.all(uniquePlanIds.map((planId) => getOwnedPlanOrThrow(ctx, user._id, planId))),
      ctx.db
        .query('planPreferences')
        .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
        .collect(),
    ]);

    const plansById = new Map(uniquePlanIds.map((planId, index) => [planId, plans[index]]));
    const preferencesByPlanId = new Map(
      existingPreferences.map((preference) => [preference.planId, preference]),
    );

    for (const planId of uniquePlanIds) {
      const plan = plansById.get(planId);
      if (!plan) continue;
      const existing = preferencesByPlanId.get(planId);
      const now = Date.now();

      if (existing) {
        if (existing.lastSeenUpdatedAt === plan.updatedAt) continue;
        await ctx.db.patch(existing._id, {
          lastSeenUpdatedAt: plan.updatedAt,
          updatedAt: now,
        });
        continue;
      }

      await ctx.db.insert('planPreferences', {
        ownerId: user._id,
        planId,
        pinned: false,
        lastSeenUpdatedAt: plan.updatedAt,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});
