/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const makeConvex = () => convexTest(schema, modules);
type TestConvex = ReturnType<typeof makeConvex>;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function paidSnapshot(userId: string, stripeCustomerId: string) {
  return {
    userId,
    stripeCustomerId,
    stripeSubscriptionId: `sub_for_${stripeCustomerId}`,
    status: 'active' as const,
    plan: 'yearly' as const,
    currentPeriodEnd: Date.now() + 365 * DAY_MS,
    cancelAtPeriodEnd: false,
  };
}

async function subscriptionsFor(t: TestConvex, userId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
  );
}

test('a trialing user who pays is upgraded by the webhook sync', async () => {
  const t = makeConvex();
  await t.mutation(internal.subscriptions.startTrial, { userId: 'trial-user' });

  await t.mutation(
    internal.subscriptions.syncCanonicalSubscription,
    paidSnapshot('trial-user', 'cus_trial'),
  );

  const rows = await subscriptionsFor(t, 'trial-user');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    stripeCustomerId: 'cus_trial',
    stripeSubscriptionId: 'sub_for_cus_trial',
    status: 'active',
    plan: 'yearly',
  });
});

test('a user who skipped the trial and then pays is upgraded by the webhook sync', async () => {
  const t = makeConvex();
  await t.mutation(internal.subscriptions.skipTrial, { userId: 'skip-user' });

  await t.mutation(
    internal.subscriptions.syncCanonicalSubscription,
    paidSnapshot('skip-user', 'cus_skip'),
  );

  const rows = await subscriptionsFor(t, 'skip-user');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    stripeCustomerId: 'cus_skip',
    stripeSubscriptionId: 'sub_for_cus_skip',
    status: 'active',
  });
});

test('a row owned by a different real Stripe customer is still not replaced', async () => {
  const t = makeConvex();
  await t.mutation(
    internal.subscriptions.syncCanonicalSubscription,
    paidSnapshot('paid-user', 'cus_original'),
  );

  await t.mutation(
    internal.subscriptions.syncCanonicalSubscription,
    paidSnapshot('paid-user', 'cus_intruder'),
  );

  const rows = await subscriptionsFor(t, 'paid-user');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    stripeCustomerId: 'cus_original',
    stripeSubscriptionId: 'sub_for_cus_original',
  });
});
