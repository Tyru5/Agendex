import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { stripeComponent } from './stripe';

export async function getMySubscription(ctx: any) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) return null;

  const subscription = await ctx.db
    .query('subscriptions')
    .withIndex('by_user', (q: any) => q.eq('userId', user._id))
    .first();

  return subscription;
}

export async function hasActiveSubscription(ctx: any): Promise<boolean> {
  const sub = await getMySubscription(ctx);
  return sub ? sub.status === 'active' : false;
}

export const getMySubscriptionQuery = query({
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return null;

    return await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q: any) => q.eq('userId', user._id))
      .first();
  },
});

export const createCheckoutSession = mutation({
  args: { plan: v.union(v.literal('monthly'), v.literal('yearly')) },
  handler: async (ctx, { plan }) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Not authenticated');

    const priceId =
      plan === 'monthly' ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_YEARLY_PRICE_ID;

    if (!priceId) {
      throw new ConvexError('Price ID not configured');
    }

    // Get or create Stripe customer
    const existingSub = await getMySubscription(ctx);
    let customerId = existingSub?.stripeCustomerId;

    if (!customerId) {
      // Create new customer via Stripe component
      const customer = await (stripeComponent as any).customer.create(ctx, {
        email: user.email,
      });
      customerId = customer.id;
    }

    // Create checkout session
    const session = await (stripeComponent as any).checkout.create(ctx, {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.VITE_CONVEX_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VITE_CONVEX_URL}/pricing`,
    });

    return { url: session.url };
  },
});

export const createPortalSession = mutation({
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Not authenticated');

    const sub = await getMySubscription(ctx);
    if (!sub) throw new ConvexError('No subscription found');

    const session = await (stripeComponent as any).portal.create(ctx, {
      customer: sub.stripeCustomerId,
      return_url: `${process.env.VITE_CONVEX_URL}/dashboard`,
    });

    return { url: session.url };
  },
});
