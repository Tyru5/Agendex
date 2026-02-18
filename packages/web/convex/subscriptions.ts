import { ConvexError, v } from 'convex/values';
import { action, internalMutation, query } from './_generated/server';
import { api, internal } from './_generated/api';
import { authComponent } from './auth';
import { stripe } from './stripe';
import Stripe from 'stripe';

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
      .withIndex('by_user', (q: any) => q.eq('userId', user._id))
      .first();
  },
});

export async function hasActiveSubscription(ctx: any): Promise<boolean> {
  let user;
  try {
    user = await (await import('./auth')).authComponent.getAuthUser(ctx);
  } catch {
    return false;
  }
  if (!user) return false;

  const sub = await ctx.db
    .query('subscriptions')
    .withIndex('by_user', (q: any) => q.eq('userId', user._id))
    .first();

  return sub ? sub.status === 'active' && sub.currentPeriodEnd > Date.now() : false;
}

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
      successUrl: `${siteUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}/pricing`,
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

    const sub = await ctx.runQuery((api as any).subscriptions.getMySubscriptionQuery);
    if (!sub?.stripeSubscriptionId) throw new ConvexError('No subscription found');

    const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
    await stripeClient.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await ctx.runMutation((internal as any).subscriptions.syncSubscriptionUpdate, {
      stripeSubscriptionId: sub.stripeSubscriptionId,
      status: 'active',
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: false,
    });

    return { ok: true };
  },
});

export const createPortalSession = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    const sub = await ctx.runQuery((api as any).subscriptions.getMySubscriptionQuery);
    if (!sub) throw new ConvexError('No subscription found');

    const siteUrl = process.env.SITE_URL ?? '';

    const { url } = await stripe.createCustomerPortalSession(ctx, {
      customerId: sub.stripeCustomerId,
      returnUrl: `${siteUrl}/dashboard`,
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
      .withIndex('by_user', (q: any) => q.eq('userId', args.userId))
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
      .withIndex('by_stripe_subscription', (q: any) =>
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
      .withIndex('by_stripe_subscription', (q: any) =>
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
