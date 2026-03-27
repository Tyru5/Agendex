import { useMemo } from 'react';
import type { Subscription } from './useSubscription';

export function useSubscriptionView(
  subscription: Subscription | null | undefined,
  isActive: boolean,
  isTrialing: boolean,
  trialDaysLeft: number,
) {
  return useMemo(() => {
    const isFreePlan = subscription?.status === 'canceled' && !subscription?.stripeSubscriptionId;

    const statusLabel = isTrialing
      ? 'Trial'
      : isActive
        ? 'Pro'
        : isFreePlan
          ? 'Free'
          : subscription?.status === 'canceled'
            ? 'Canceled'
            : 'Free';

    return {
      statusLabel,
      isFreePlan,
      renewalDate:
        subscription?.currentPeriodEnd != null
          ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : null,
      cadence:
        subscription?.plan === 'monthly'
          ? 'Monthly'
          : subscription?.plan === 'yearly'
            ? 'Yearly'
            : null,
      trialDaysLeft,
    };
  }, [subscription, isActive, isTrialing, trialDaysLeft]);
}
