import { registerRoutes } from '@convex-dev/stripe';
import { httpRouter } from 'convex/server';
import type Stripe from 'stripe';
import { internal } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { heartbeat, refresh, sync } from './cli';
import { stripeComponent } from './stripe';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

registerRoutes(http, stripeComponent, {
  events: {
    'customer.subscription.created': async (ctx, event) => {
      const subscription = event.data.object as Stripe.Subscription;
      const item = subscription.items.data[0];

      const userId = subscription.metadata?.userId;
      const plan = subscription.metadata?.plan as 'monthly' | 'yearly' | undefined;
      if (!userId || !plan) {
        console.error(
          `[stripe webhook] subscription.created missing metadata: userId=${userId}, plan=${plan}, subId=${subscription.id}`,
        );
        return;
      }

      await ctx.runMutation((internal as any).subscriptions.fulfillCheckout, {
        userId,
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        plan,
        currentPeriodEnd: (item?.current_period_end ?? 0) * 1000,
      });
    },
    'customer.subscription.updated': async (ctx, event) => {
      const subscription = event.data.object as Stripe.Subscription;
      const item = subscription.items.data[0];

      await ctx.runMutation((internal as any).subscriptions.syncSubscriptionUpdate, {
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: (item?.current_period_end ?? 0) * 1000,
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
http.route({ path: '/api/cli/heartbeat', method: 'POST', handler: heartbeat });

export default http;
