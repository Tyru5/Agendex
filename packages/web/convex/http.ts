import { httpRouter } from 'convex/server';
import { registerRoutes } from '@convex-dev/stripe';
import { authComponent, createAuth } from './auth';
import { stripeComponent } from './stripe';
import { internal } from './_generated/api';
import { sync, refresh } from './cli';
import type Stripe from 'stripe';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

registerRoutes(http, stripeComponent, {
  events: {
    'checkout.session.completed': async (ctx, event) => {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription' || !session.subscription) return;

      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan as 'monthly' | 'yearly' | undefined;
      if (!userId || !plan) return;

      await ctx.runMutation((internal as any).subscriptions.fulfillCheckout, {
        userId,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
        plan,
        currentPeriodEnd: Math.floor(Date.now() / 1000) + (plan === 'yearly' ? 365 : 30) * 86400,
      });
    },
    'customer.subscription.updated': async (ctx, event) => {
      const subscription = event.data.object as Stripe.Subscription;
      const item = subscription.items.data[0];

      await ctx.runMutation((internal as any).subscriptions.syncSubscriptionUpdate, {
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: item?.current_period_end || 0,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      });
    },
    'customer.subscription.deleted': async (ctx, event) => {
      const subscription = event.data.object as Stripe.Subscription;

      await ctx.runMutation((internal as any).subscriptions.syncSubscriptionDeletion, {
        stripeSubscriptionId: subscription.id,
      });
    },
  },
});

http.route({ path: '/api/cli/sync', method: 'POST', handler: sync });
http.route({ path: '/api/cli/refresh', method: 'POST', handler: refresh });

export default http;
