import { ConvexError, v } from 'convex/values';
import Stripe from 'stripe';
import { api, internal } from './_generated/api';
import { action, internalMutation, type QueryCtx, query } from './_generated/server';
import { authComponent } from './auth';
import { stripe } from './stripe';

export const getMySubscriptionQuery = query({
  handler: async (ctx) => {
    let user;
    try {
      user = await authComponent.getAuthUser(ctx);
    } catch {
      return null;
    }
    if (!user) return null;

    return await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first();
  },
});

export async function hasActiveSubscriptionForUserId(
  ctx: QueryCtx,
  userId: string,
): Promise<boolean> {
  const sub = await ctx.db
    .query('subscriptions')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();

  if (!sub) return false;
  const valid = sub.currentPeriodEnd > Date.now();
  return valid && (sub.status === 'active' || sub.status === 'trialing');
}

export async function hasActiveSubscription(ctx: QueryCtx): Promise<boolean> {
  let user;
  try {
    user = await authComponent.getAuthUser(ctx);
  } catch {
    return false;
  }
  if (!user) return false;

  return hasActiveSubscriptionForUserId(ctx, user._id);
}

export const hasCompletedOnboarding = query({
  handler: async (ctx) => {
    let user;
    try {
      user = await authComponent.getAuthUser(ctx);
    } catch {
      // Auth error — treat as onboarding complete to avoid blank screen
      return true;
    }
    if (!user) return false;

    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first();

    if (sub !== null) return true;

    const membership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_member', (q) => q.eq('memberId', user._id))
      .first();

    return membership !== null;
  },
});

export const startTrial = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (existing) return;

    const TRIAL_DAYS = 7;
    const trialEnd = Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000;

    await ctx.db.insert('subscriptions', {
      userId,
      stripeCustomerId: '',
      stripeSubscriptionId: '',
      status: 'trialing',
      plan: 'monthly',
      currentPeriodEnd: trialEnd,
      cancelAtPeriodEnd: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const startTrialAction = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    await ctx.runMutation(internal.subscriptions.startTrial, { userId: user._id });
    return { ok: true };
  },
});

export const skipTrial = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (existing) return;

    await ctx.db.insert('subscriptions', {
      userId,
      stripeCustomerId: '',
      stripeSubscriptionId: '',
      status: 'canceled',
      plan: 'monthly',
      currentPeriodEnd: Date.now(),
      cancelAtPeriodEnd: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const skipTrialAction = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    await ctx.runMutation(internal.subscriptions.skipTrial, { userId: user._id });
    return { ok: true };
  },
});

export const createCheckoutSession = action({
  args: { plan: v.union(v.literal('monthly'), v.literal('yearly')) },
  handler: async (ctx, { plan }) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    const priceId =
      plan === 'monthly' ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_YEARLY_PRICE_ID;

    if (!priceId) throw new ConvexError('Price ID not configured');

    const siteUrl = process.env.SITE_URL ?? '';

    const { customerId } = await stripe.getOrCreateCustomer(ctx, {
      userId: user._id,
      email: user.email,
      name: user.name,
    });

    const session = await stripe.createCheckoutSession(ctx, {
      priceId,
      customerId,
      mode: 'subscription',
      successUrl: `${siteUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}/`,
      metadata: { userId: user._id, plan },
      subscriptionMetadata: { userId: user._id, plan },
    });

    return { url: session.url };
  },
});

export const reactivateSubscription = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    const sub = await ctx.runQuery(api.subscriptions.getMySubscriptionQuery);
    if (!sub?.stripeSubscriptionId) throw new ConvexError('No subscription found');

    const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const updated = await stripeClient.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    const item = updated.items.data[0];
    await ctx.runMutation(internal.subscriptions.syncSubscriptionUpdate, {
      stripeSubscriptionId: sub.stripeSubscriptionId,
      status: updated.status,
      currentPeriodEnd: (item?.current_period_end ?? 0) * 1000,
      cancelAtPeriodEnd: false,
    });

    return { ok: true };
  },
});

export const createPortalSession = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    const sub = await ctx.runQuery(api.subscriptions.getMySubscriptionQuery);
    if (!sub) throw new ConvexError('No subscription found');

    const siteUrl = process.env.SITE_URL ?? '';

    const { url } = await stripe.createCustomerPortalSession(ctx, {
      customerId: sub.stripeCustomerId,
      returnUrl: `${siteUrl}/`,
    });

    return { url };
  },
});

// --- Webhook sync mutations (called from http.ts event handlers) ---

export const fulfillCheckout = internalMutation({
  args: {
    userId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    plan: v.union(v.literal('monthly'), v.literal('yearly')),
    currentPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        status: 'active',
        plan: args.plan,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert('subscriptions', {
        userId: args.userId,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        status: 'active',
        plan: args.plan,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});

export const syncSubscriptionUpdate = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('canceled'),
      v.literal('past_due'),
      v.literal('incomplete'),
      v.literal('incomplete_expired'),
      v.literal('trialing'),
      v.literal('paused'),
      v.literal('unpaid'),
    ),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_stripe_subscription', (q) =>
        q.eq('stripeSubscriptionId', args.stripeSubscriptionId),
      )
      .first();

    if (sub) {
      await ctx.db.patch(sub._id, {
        status: args.status,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        updatedAt: Date.now(),
      });
    }
  },
});

export const syncSubscriptionDeletion = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_stripe_subscription', (q) =>
        q.eq('stripeSubscriptionId', args.stripeSubscriptionId),
      )
      .first();

    if (sub) {
      await ctx.db.patch(sub._id, {
        status: 'canceled',
        updatedAt: Date.now(),
      });
    }
  },
});
