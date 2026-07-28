import { Skeleton } from '@agendex/web';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';
import { PricingModal } from './PricingModal';

/**
 * Topbar upgrade signal only. Pro/billing management lives in the account menu.
 * Renders nothing when the user is on an active paid plan.
 */
export function SubscriptionBadge() {
  const { isActive, isTrialing, trialDaysLeft, isLoading } = useSubscription();
  const { isAuthenticated } = useAuth();
  const [showPricing, setShowPricing] = useState(false);

  if (!isAuthenticated) return null;
  if (isLoading) {
    return (
      <div className="agendex-topbar-control">
        <Skeleton width="72px" height="30px" borderRadius="var(--radius)" />
      </div>
    );
  }

  if (isTrialing) {
    return (
      <>
        <div className="agendex-topbar-control">
          <button
            type="button"
            onClick={() => setShowPricing(true)}
            className="subscription-pill h-[30px] px-2.5 rounded-lg font-semibold text-[12px] cursor-pointer whitespace-nowrap"
            title={`${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left in trial`}
          >
            Trial · {trialDaysLeft}d
          </button>
        </div>
        {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
      </>
    );
  }

  // Paid Pro: no topbar chrome. Billing is in the account menu.
  if (isActive) return null;

  return (
    <>
      <div className="agendex-topbar-control">
        <button
          type="button"
          onClick={() => setShowPricing(true)}
          className="subscription-pill h-[30px] px-2.5 rounded-lg text-[12px] font-semibold cursor-pointer"
        >
          Upgrade
        </button>
      </div>
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </>
  );
}
