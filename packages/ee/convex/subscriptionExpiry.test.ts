import { expect, test } from 'bun:test';
import { ProFeature } from '@agendex/shared/types';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { requireFeatureForUserId } from './entitlements';
import {
  type DbCtx,
  expireInternalTrialIfCurrent,
  hasActiveSubscriptionForUserId,
  type SubscriptionAccessState,
} from './subscriptions';

const subscriptionId = 'subscription-test' as Id<'subscriptions'>;
const userId = 'subscription-expiry-test-user';

type TestSubscription = SubscriptionAccessState & {
  _id: Id<'subscriptions'>;
  stripeSubscriptionId: string;
  currentPeriodEnd: number;
};

function createSubscriptionHarness(initial: TestSubscription) {
  let subscription = { ...initial };
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async () => subscription,
      patch: async (_id: Id<'subscriptions'>, patch: Record<string, unknown>) => {
        patches.push(patch);
        subscription = { ...subscription, ...patch } as TestSubscription;
      },
    },
  } as unknown as MutationCtx;

  return {
    ctx,
    get subscription() {
      return subscription;
    },
    patches,
  };
}

function subscriptionQueryCtx(getSubscription: () => SubscriptionAccessState | null): DbCtx {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => getSubscription(),
        }),
      }),
    },
  } as unknown as DbCtx;
}

test('internal trial remains entitled before its stored expiry transition', async () => {
  const harness = createSubscriptionHarness({
    _id: subscriptionId,
    status: 'trialing',
    stripeSubscriptionId: '',
    currentPeriodEnd: 1_000,
  });

  const expired = await expireInternalTrialIfCurrent(harness.ctx, {
    subscriptionId,
    expectedCurrentPeriodEnd: 1_000,
    now: 999,
  });

  expect(expired).toBe(false);
  expect(harness.subscription.status).toBe('trialing');
  expect(
    await hasActiveSubscriptionForUserId(
      subscriptionQueryCtx(() => harness.subscription),
      userId,
    ),
  ).toBe(true);
});

test('scheduled expiry transitions once and retries are idempotent', async () => {
  const harness = createSubscriptionHarness({
    _id: subscriptionId,
    status: 'trialing',
    stripeSubscriptionId: '',
    currentPeriodEnd: 1_000,
  });

  expect(
    await expireInternalTrialIfCurrent(harness.ctx, {
      subscriptionId,
      expectedCurrentPeriodEnd: 1_000,
      now: 1_000,
    }),
  ).toBe(true);
  expect(harness.subscription.status).toBe('canceled');
  expect(
    await hasActiveSubscriptionForUserId(
      subscriptionQueryCtx(() => harness.subscription),
      userId,
    ),
  ).toBe(false);

  expect(
    await expireInternalTrialIfCurrent(harness.ctx, {
      subscriptionId,
      expectedCurrentPeriodEnd: 1_000,
      now: 1_001,
    }),
  ).toBe(false);
  expect(harness.patches).toHaveLength(1);
});

test('stale expiry jobs cannot downgrade paid upgrades or newer trials', async () => {
  const paid = createSubscriptionHarness({
    _id: subscriptionId,
    status: 'active',
    stripeSubscriptionId: 'sub_paid',
    currentPeriodEnd: 10_000,
  });
  expect(
    await expireInternalTrialIfCurrent(paid.ctx, {
      subscriptionId,
      expectedCurrentPeriodEnd: 1_000,
      now: 20_000,
    }),
  ).toBe(false);
  expect(paid.subscription.status).toBe('active');
  expect(paid.patches).toHaveLength(0);

  const newerTrial = createSubscriptionHarness({
    _id: subscriptionId,
    status: 'trialing',
    stripeSubscriptionId: '',
    currentPeriodEnd: 30_000,
  });
  expect(
    await expireInternalTrialIfCurrent(newerTrial.ctx, {
      subscriptionId,
      expectedCurrentPeriodEnd: 1_000,
      now: 40_000,
    }),
  ).toBe(false);
  expect(newerTrial.subscription.status).toBe('trialing');
  expect(newerTrial.patches).toHaveLength(0);
});

test('CLI sync authorization trusts stored status rather than a client clock', async () => {
  const futureCanceled = {
    status: 'canceled' as const,
    currentPeriodEnd: Number.MAX_SAFE_INTEGER,
  };
  expect(
    await hasActiveSubscriptionForUserId(
      subscriptionQueryCtx(() => futureCanceled),
      userId,
    ),
  ).toBe(false);
});

test('sharing authorization fails closed after the stored expiry transition', async () => {
  const ctx = subscriptionQueryCtx(() => ({ status: 'canceled' }));
  let rejected = false;

  try {
    await requireFeatureForUserId(ctx, userId, ProFeature.SHARE_LINKS);
  } catch {
    rejected = true;
  }

  expect(rejected).toBe(true);
});
