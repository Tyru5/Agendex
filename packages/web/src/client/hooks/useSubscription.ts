import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';

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
  const subscription = useQuery(api.subscriptions.getMySubscriptionQuery);
  const createCheckout = useMutation(api.subscriptions.createCheckoutSession);
  const createPortal = useMutation(api.subscriptions.createPortalSession);

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
  };
}
