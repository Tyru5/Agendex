import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';

type OwnedPlan = { ownerId: string; updatedAt: number } | null;

async function getOwnedPlanOrThrow(
  ctx: { db: { get: (id: unknown) => Promise<OwnedPlan> } },
  ownerId: string,
  planId: unknown,
) {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.ownerId !== ownerId) {
    throw new ConvexError('Plan not found');
  }
  return plan;
}

export const listForMyPlans = query({
  args: {},
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
      if (!existing) return;
      if (existing.lastSeenUpdatedAt === undefined) {
        await ctx.db.delete(existing._id);
        return;
      }
      await ctx.db.patch(existing._id, { pinned: false, updatedAt: now });
      return;
    }

    if (existing) {
      if (existing.pinned) return;
      await ctx.db.patch(existing._id, { pinned: true, updatedAt: now });
      return;
    }

    await ctx.db.insert('planPreferences', {
      ownerId: user._id,
      planId: args.planId,
      pinned: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markSeen = mutation({
  args: { planId: v.id('plans') },
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
      if (existing.lastSeenUpdatedAt === plan.updatedAt) return;
      await ctx.db.patch(existing._id, {
        lastSeenUpdatedAt: plan.updatedAt,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert('planPreferences', {
      ownerId: user._id,
      planId: args.planId,
      pinned: false,
      lastSeenUpdatedAt: plan.updatedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markUnseen = mutation({
  args: { planId: v.id('plans') },
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
      return;
    }

    if (existing.lastSeenUpdatedAt === undefined) return;
    if (!existing.pinned) {
      await ctx.db.delete(existing._id);
      return;
    }

    await ctx.db.patch(existing._id, {
      lastSeenUpdatedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const markManySeen = mutation({
  args: { planIds: v.array(v.id('plans')) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    if (args.planIds.length === 0) return;

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
  },
});
