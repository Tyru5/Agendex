import { ConvexError, v } from 'convex/values';
import Stripe from 'stripe';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  action,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from './_generated/server';
import { authComponent } from './auth';
import { stripe } from './stripe';

function isProBypassUserId(userId: string): boolean {
  const bypassIds = (process.env.PRO_BYPASS_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return bypassIds.includes(userId);
}

export type SubscriptionAccessState = Pick<Doc<'subscriptions'>, 'status'>;

type InternalTrialExpiryState = Pick<
  Doc<'subscriptions'>,
  'status' | 'stripeSubscriptionId' | 'currentPeriodEnd'
>;

/**
 * Entitlements depend only on stored state so Convex can cache queries safely.
 * Trial expiry jobs transition that state and invalidate dependent queries.
 */
export function subscriptionStateGrantsPro(
  subscription: SubscriptionAccessState | null | undefined,
): boolean {
  return subscription?.status === 'active' || subscription?.status === 'trialing';
}

/** Returns a patch only when the job still targets the same internal trial generation. */
export function internalTrialExpiryPatch(
  subscription: InternalTrialExpiryState,
  expectedCurrentPeriodEnd: number,
  now: number,
): { status: 'canceled'; updatedAt: number } | null {
  if (
    subscription.status !== 'trialing' ||
    subscription.stripeSubscriptionId !== '' ||
    subscription.currentPeriodEnd !== expectedCurrentPeriodEnd ||
    subscription.currentPeriodEnd > now
  ) {
    return null;
  }

  return { status: 'canceled', updatedAt: now };
}

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

/** Shared DB read access for queries and mutations. */
export type DbCtx = QueryCtx | MutationCtx;

export async function hasActiveSubscriptionForUserId(ctx: DbCtx, userId: string): Promise<boolean> {
  if (isProBypassUserId(userId)) return true;

  const sub = await ctx.db
    .query('subscriptions')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();

  return subscriptionStateGrantsPro(sub);
}

export async function hasActiveSubscription(ctx: DbCtx): Promise<boolean> {
  let user;
  try {
    user = await authComponent.getAuthUser(ctx);
  } catch {
    return false;
  }
  if (!user) return false;

  return hasActiveSubscriptionForUserId(ctx, user._id);
}

export const isProUser = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return hasActiveSubscription(ctx);
  },
});

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

    if (isProBypassUserId(user._id)) return true;

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
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (existing) return null;

    const TRIAL_DAYS = 7;
    const now = Date.now();
    const trialEnd = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;

    const subscriptionId = await ctx.db.insert('subscriptions', {
      userId,
      stripeCustomerId: '',
      stripeSubscriptionId: '',
      status: 'trialing',
      plan: 'monthly',
      currentPeriodEnd: trialEnd,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAt(trialEnd, internal.subscriptions.expireInternalTrial, {
      subscriptionId,
      expectedCurrentPeriodEnd: trialEnd,
    });
    return null;
  },
});

export async function expireInternalTrialIfCurrent(
  ctx: MutationCtx,
  args: {
    subscriptionId: Id<'subscriptions'>;
    expectedCurrentPeriodEnd: number;
    now: number;
  },
): Promise<boolean> {
  const subscription = await ctx.db.get(args.subscriptionId);
  if (!subscription) return false;

  const patch = internalTrialExpiryPatch(subscription, args.expectedCurrentPeriodEnd, args.now);
  if (!patch) return false;

  await ctx.db.patch(args.subscriptionId, patch);
  return true;
}

export const expireInternalTrial = internalMutation({
  args: {
    subscriptionId: v.id('subscriptions'),
    expectedCurrentPeriodEnd: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return expireInternalTrialIfCurrent(ctx, { ...args, now: Date.now() });
  },
});

const EXPIRY_SWEEP_BATCH_SIZE = 100;

export const expireOverdueInternalTrials = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const now = Date.now();
    const overdue = await ctx.db
      .query('subscriptions')
      .withIndex('by_status_and_stripeSubscriptionId_and_currentPeriodEnd', (q) =>
        q.eq('status', 'trialing').eq('stripeSubscriptionId', '').lte('currentPeriodEnd', now),
      )
      .take(EXPIRY_SWEEP_BATCH_SIZE);

    let expired = 0;
    for (const subscription of overdue) {
      const patch = internalTrialExpiryPatch(subscription, subscription.currentPeriodEnd, now);
      if (!patch) continue;
      await ctx.db.patch(subscription._id, patch);
      expired += 1;
    }

    if (overdue.length === EXPIRY_SWEEP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.subscriptions.expireOverdueInternalTrials, {});
    }

    return expired;
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
