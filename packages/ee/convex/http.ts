import { registerRoutes } from '@convex-dev/stripe';
import { httpRouter, type GenericActionCtx, type GenericDataModel } from 'convex/server';
import Stripe from 'stripe';
import { internal } from './_generated/api';
import { authComponent, createAuth, resolveAuthTrustedOrigins } from './auth';
import {
  deleteDaemonsHttp,
  devices,
  downloadPlan,
  listPlans,
  convexToken,
  cryptoStatus,
  cryptoPlanIdentity,
  heartbeat,
  plannotatorWritebackReport,
  plannotatorWritebacks,
  preferences,
  refresh,
  sync,
} from './cli';
import { stripeComponent } from './stripe';
import { loadCanonicalSubscriptionSnapshot } from './subscriptions';

async function syncCanonicalStripeSubscription(
  ctx: GenericActionCtx<GenericDataModel>,
  event: Stripe.Event,
): Promise<void> {
  const eventSubscription = event.data.object as Stripe.Subscription;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');

  const stripeClient = new Stripe(secretKey);
  const snapshot = await loadCanonicalSubscriptionSnapshot(
    eventSubscription.id,
    {
      monthly: process.env.STRIPE_MONTHLY_PRICE_ID,
      yearly: process.env.STRIPE_YEARLY_PRICE_ID,
    },
    (subscriptionId) => stripeClient.subscriptions.retrieve(subscriptionId),
  );

  if (!snapshot.plan) {
    console.error(
      `[stripe webhook] subscription ${snapshot.stripeSubscriptionId} has an unrecognized price; access will not be granted`,
    );
  }

  await ctx.runMutation(internal.subscriptions.syncCanonicalSubscription, snapshot);
}

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: resolveAuthTrustedOrigins({
      APP_URL: process.env.APP_URL,
      BETTER_AUTH_ENVIRONMENT: process.env.BETTER_AUTH_ENVIRONMENT,
      BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
      SITE_URL: process.env.SITE_URL,
    }),
  },
});

registerRoutes(http, stripeComponent, {
  webhookPath: '/stripe/webhook',
  events: {
    'customer.subscription.created': syncCanonicalStripeSubscription,
    'customer.subscription.updated': syncCanonicalStripeSubscription,
    'customer.subscription.deleted': syncCanonicalStripeSubscription,
  },
});

http.route({ path: '/api/cli/sync', method: 'POST', handler: sync });
http.route({ path: '/api/cli/preferences', method: 'GET', handler: preferences });
http.route({ path: '/api/cli/crypto', method: 'GET', handler: cryptoStatus });
http.route({ path: '/api/cli/crypto/plan', method: 'GET', handler: cryptoPlanIdentity });
http.route({ path: '/api/cli/refresh', method: 'POST', handler: refresh });
http.route({ path: '/api/cli/convex-token', method: 'GET', handler: convexToken });
http.route({ path: '/api/cli/heartbeat', method: 'POST', handler: heartbeat });
http.route({ path: '/api/cli/devices', method: 'GET', handler: devices });
http.route({ path: '/api/cli/devices', method: 'DELETE', handler: deleteDaemonsHttp });
http.route({ path: '/api/cli/plan', method: 'GET', handler: downloadPlan });
http.route({ path: '/api/cli/plans', method: 'GET', handler: listPlans });
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
