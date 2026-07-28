import { api } from '@convex/_generated/api';
import { useAction, useQuery } from 'convex/react';

export interface Subscription {
  _id: string;
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status:
    | 'active'
    | 'canceled'
    | 'past_due'
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing'
    | 'paused'
    | 'unpaid';
  plan: 'monthly' | 'yearly';
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  createdAt: number;
  updatedAt: number;
}

type UseSubscriptionOptions = {
  enabled?: boolean;
};

export function useSubscription(options: UseSubscriptionOptions = {}) {
  const enabled = options.enabled ?? true;

  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const subscription = useQuery(
    // Convex component API not in generated types
    // oxlint-disable-next-line typescript/no-explicit-any
    (api as any).subscriptions.getMySubscriptionQuery,
    enabled ? {} : 'skip',
  );
  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const isProUser = useQuery(
    // Convex component API not in generated types
    // oxlint-disable-next-line typescript/no-explicit-any
    (api as any).subscriptions.isProUser,
    enabled ? {} : 'skip',
  );
  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const onboardingDone = useQuery(
    // Convex component API not in generated types
    // oxlint-disable-next-line typescript/no-explicit-any
    (api as any).subscriptions.hasCompletedOnboarding,
    enabled ? {} : 'skip',
  );
  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const createCheckout = useAction((api as any).subscriptions.createCheckoutSession);
  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const createPortal = useAction((api as any).subscriptions.createPortalSession);
  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const reactivate = useAction((api as any).subscriptions.reactivateSubscription);
  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const startTrialFn = useAction((api as any).subscriptions.startTrialAction);
  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const skipTrialFn = useAction((api as any).subscriptions.skipTrialAction);

  const sub = subscription as Subscription | null | undefined;
  const isTrialing = sub?.status === 'trialing' && (sub?.currentPeriodEnd ?? 0) > Date.now();
  const isActive = isProUser === true || sub?.status === 'active' || isTrialing;
  const canManageBilling =
    Boolean(sub?.stripeSubscriptionId) &&
    (sub?.status === 'active' || sub?.status === 'past_due' || sub?.status === 'unpaid');
  const subscriptionLoading = enabled && (subscription === undefined || isProUser === undefined);
  const onboardingLoading = enabled && onboardingDone === undefined;
  const onboardingResolved = !enabled || (!subscriptionLoading && !onboardingLoading);

  const trialDaysLeft = isTrialing
    ? Math.max(0, Math.ceil(((sub?.currentPeriodEnd ?? 0) - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    subscription: sub,
    isActive,
    canManageBilling,
    isTrialing,
    trialDaysLeft,
    isLoading: subscriptionLoading,
    needsOnboarding: enabled && onboardingDone === false,
    onboardingLoading,
    onboardingResolved,
    createCheckout: async (plan: 'monthly' | 'yearly') => {
      try {
        const result = await createCheckout({ plan });
        if (result.url) {
          window.location.href = result.url;
        }
      } catch (err) {
        console.error('Checkout error:', err);
        throw err;
      }
    },
    createPortal: async () => {
      try {
        const result = await createPortal();
        if (result.url) {
          window.location.href = result.url;
        }
      } catch (err) {
        console.error('Portal error:', err);
        throw err;
      }
    },
    reactivate: async () => {
      try {
        await reactivate();
      } catch (err) {
        console.error('Reactivation error:', err);
        throw err;
      }
    },
    startTrial: async () => {
      try {
        await startTrialFn();
      } catch (err) {
        console.error('Trial start error:', err);
        throw err;
      }
    },
    skipTrial: async () => {
      try {
        await skipTrialFn();
      } catch (err) {
        console.error('Skip trial error:', err);
        throw err;
      }
    },
  };
}
