import { expect, test } from 'bun:test';
import type Stripe from 'stripe';
import {
  canonicalSubscriptionSnapshot,
  loadCanonicalSubscriptionSnapshot,
  resolveSubscriptionPlan,
  subscriptionStatusForPlan,
  type ConfiguredStripePrices,
} from './subscriptions';

const prices: ConfiguredStripePrices = {
  monthly: 'price_monthly',
  yearly: 'price_yearly',
};

function subscriptionFixture({
  status,
  cancelAtPeriodEnd = false,
  priceId = prices.monthly!,
  metadataPlan = 'monthly',
  id = 'sub_123',
}: {
  status: Stripe.Subscription.Status;
  cancelAtPeriodEnd?: boolean;
  priceId?: string;
  metadataPlan?: string;
  id?: string;
}): Stripe.Subscription {
  return {
    id,
    customer: 'cus_123',
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    metadata: { userId: 'user_123', plan: metadataPlan },
    items: {
      data: [
        {
          current_period_end: 1_800_000_000,
          price: { id: priceId },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

test('canonical snapshots preserve every Stripe entitlement status and cancellation flag', () => {
  const cases: Array<{
    status: Stripe.Subscription.Status;
    cancelAtPeriodEnd: boolean;
  }> = [
    { status: 'incomplete', cancelAtPeriodEnd: false },
    { status: 'past_due', cancelAtPeriodEnd: true },
    { status: 'paused', cancelAtPeriodEnd: false },
    { status: 'trialing', cancelAtPeriodEnd: true },
    { status: 'canceled', cancelAtPeriodEnd: false },
    { status: 'active', cancelAtPeriodEnd: true },
  ];

  for (const entry of cases) {
    const snapshot = canonicalSubscriptionSnapshot(
      subscriptionFixture({
        status: entry.status,
        cancelAtPeriodEnd: entry.cancelAtPeriodEnd,
      }),
      prices,
    );

    expect(snapshot.status).toBe(entry.status);
    expect(snapshot.cancelAtPeriodEnd).toBe(entry.cancelAtPeriodEnd);
  }
});

test('configured Stripe price wins over untrusted plan metadata', () => {
  const subscription = subscriptionFixture({
    status: 'active',
    priceId: prices.monthly,
    metadataPlan: 'yearly',
  });

  expect(resolveSubscriptionPlan(subscription, prices)).toBe('monthly');
});

test('unknown, ambiguous, and multi-item prices are rejected', () => {
  const unknownPrice = subscriptionFixture({
    status: 'active',
    priceId: 'price_unknown',
    metadataPlan: 'monthly',
  });
  expect(resolveSubscriptionPlan(unknownPrice, prices)).toBeNull();
  expect(subscriptionStatusForPlan(unknownPrice.status, null)).toBe('canceled');
  expect(
    resolveSubscriptionPlan(unknownPrice, { monthly: undefined, yearly: undefined }),
  ).toBeNull();
  expect(
    resolveSubscriptionPlan(subscriptionFixture({ status: 'active' }), {
      monthly: 'price_monthly',
      yearly: 'price_monthly',
    }),
  ).toBeNull();

  const multiItem = subscriptionFixture({ status: 'active' });
  multiItem.items.data.push({
    current_period_end: 1_800_000_000,
    price: { id: prices.yearly },
  } as Stripe.SubscriptionItem);
  expect(resolveSubscriptionPlan(multiItem, prices)).toBeNull();
});

test('a delayed created event synchronizes the newer updated Stripe state', async () => {
  const currentSubscription = subscriptionFixture({
    status: 'past_due',
    cancelAtPeriodEnd: true,
  });
  const retrievedIds: string[] = [];

  const snapshot = await loadCanonicalSubscriptionSnapshot(
    currentSubscription.id,
    prices,
    async (subscriptionId) => {
      retrievedIds.push(subscriptionId);
      return currentSubscription;
    },
  );

  expect(retrievedIds).toEqual([currentSubscription.id]);
  expect(snapshot.status).toBe('past_due');
  expect(snapshot.cancelAtPeriodEnd).toBe(true);
});

test('a delayed created event cannot overwrite a newer deletion', async () => {
  const deletedSubscription = subscriptionFixture({ status: 'canceled' });

  const snapshot = await loadCanonicalSubscriptionSnapshot(
    deletedSubscription.id,
    prices,
    async () => deletedSubscription,
  );

  expect(snapshot.status).toBe('canceled');
  expect(snapshot.plan).toBe('monthly');
});
