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

export function useSubscription() {
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const subscription = useQuery((api as any).subscriptions.getMySubscriptionQuery);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const onboardingDone = useQuery((api as any).subscriptions.hasCompletedOnboarding);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const createCheckout = useAction((api as any).subscriptions.createCheckoutSession);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const createPortal = useAction((api as any).subscriptions.createPortalSession);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const reactivate = useAction((api as any).subscriptions.reactivateSubscription);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const startTrialFn = useAction((api as any).subscriptions.startTrialAction);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const skipTrialFn = useAction((api as any).subscriptions.skipTrialAction);

  const sub = subscription as Subscription | null | undefined;
  const isTrialing = sub?.status === 'trialing' && (sub?.currentPeriodEnd ?? 0) > Date.now();
  const isActive = sub?.status === 'active' || isTrialing;

  const trialDaysLeft = isTrialing
    ? Math.max(0, Math.ceil(((sub?.currentPeriodEnd ?? 0) - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    subscription: sub,
    isActive,
    isTrialing,
    trialDaysLeft,
    isLoading: subscription === undefined,
    needsOnboarding: onboardingDone === false,
    onboardingLoading: onboardingDone === undefined,
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
