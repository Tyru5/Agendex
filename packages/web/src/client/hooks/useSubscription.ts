import { api } from '@convex/_generated/api';
import { useAction, useQuery } from 'convex/react';

export interface Subscription {
  _id: string;
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing';
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
  const createCheckout = useAction((api as any).subscriptions.createCheckoutSession);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const createPortal = useAction((api as any).subscriptions.createPortalSession);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const reactivate = useAction((api as any).subscriptions.reactivateSubscription);

  return {
    subscription: subscription as Subscription | null | undefined,
    isActive: subscription?.status === 'active',
    isLoading: subscription === undefined,
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
  };
}
