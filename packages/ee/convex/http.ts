import { registerRoutes } from '@convex-dev/stripe';
import { httpRouter } from 'convex/server';
import type Stripe from 'stripe';
import { internal } from './_generated/api';
import { LOCAL_DEV_CORS_ORIGINS, authComponent, createAuth } from './auth';
import {
  deleteDaemonsHttp,
  devices,
  downloadPlan,
  convexToken,
  heartbeat,
  plannotatorWritebackReport,
  plannotatorWritebacks,
  preferences,
  refresh,
  sync,
} from './cli';
import { stripeComponent } from './stripe';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, {
  // registerRoutes appends these to createAuth().trustedOrigins, so SITE_URL,
  // APP_URL, and preview origins remain part of the CORS allowlist.
  cors: { allowedOrigins: [...LOCAL_DEV_CORS_ORIGINS] },
});

registerRoutes(http, stripeComponent, {
  webhookPath: '/stripe/webhook',
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

      await ctx.runMutation(internal.subscriptions.fulfillCheckout, {
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

      await ctx.runMutation(internal.subscriptions.syncSubscriptionUpdate, {
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: (item?.current_period_end ?? 0) * 1000,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      });
    },
    'customer.subscription.deleted': async (ctx, event) => {
      const subscription = event.data.object as Stripe.Subscription;

      await ctx.runMutation(internal.subscriptions.syncSubscriptionDeletion, {
        stripeSubscriptionId: subscription.id,
      });
    },
  },
});

http.route({ path: '/api/cli/sync', method: 'POST', handler: sync });
http.route({ path: '/api/cli/preferences', method: 'GET', handler: preferences });
http.route({ path: '/api/cli/refresh', method: 'POST', handler: refresh });
http.route({ path: '/api/cli/convex-token', method: 'GET', handler: convexToken });
http.route({ path: '/api/cli/heartbeat', method: 'POST', handler: heartbeat });
http.route({ path: '/api/cli/devices', method: 'GET', handler: devices });
http.route({ path: '/api/cli/devices', method: 'DELETE', handler: deleteDaemonsHttp });
http.route({ path: '/api/cli/plan', method: 'GET', handler: downloadPlan });
http.route({
  path: '/api/cli/plannotator/writebacks',
  method: 'GET',
  handler: plannotatorWritebacks,
});
http.route({
  path: '/api/cli/plannotator/writebacks/report',
  method: 'POST',
  handler: plannotatorWritebackReport,
});

export default http;
