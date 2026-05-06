import { Skeleton } from '@agendex/web';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';
import { PricingModal } from './PricingModal';

export function SubscriptionBadge() {
  const { subscription, isActive, isTrialing, trialDaysLeft, isLoading, createPortal, reactivate } =
    useSubscription();
  const { isAuthenticated } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isAuthenticated) return null;
  if (isLoading) {
    return (
      <div key="subscription-loading" className="agendex-topbar-control">
        <Skeleton width="96px" height="34px" borderRadius="var(--radius)" />
      </div>
    );
  }

  if (isTrialing) {
    return (
      <>
        <div key="subscription-trial" className="agendex-topbar-control relative">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="subscription-pill py-2 px-3 rounded-default font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
          >
            Trial · {trialDaysLeft}d left
            <span className="text-[11px] opacity-70">▼</span>
          </button>

          {showMenu && (
            <div
              ref={menuRef}
              className="agendex-popover agendex-popover--enter absolute top-full right-0 mt-1 rounded-default min-w-[220px] z-[1000]"
            >
              <div className="py-3 px-4 border-b border-border text-[13px]">
                <div className="text-secondary mb-1">Free trial</div>
                <div className="text-text font-semibold">
                  {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  setShowPricing(true);
                }}
                className="w-full py-2.5 px-4 border-none bg-transparent text-[var(--accent)] text-left cursor-pointer text-[14px] font-semibold transition-[background-color] duration-200 hover:bg-hover"
              >
                Upgrade to Pro
              </button>
            </div>
          )}
        </div>
        {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
      </>
    );
  }

  if (isActive && subscription) {
    const cancelAtPeriodEnd = subscription.cancelAtPeriodEnd;
    const endDate = new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return (
      <div key="subscription-active" className="agendex-topbar-control relative">
        <button
          type="button"
          onClick={() => setShowMenu(!showMenu)}
          className="subscription-pill py-2 px-3 rounded-default font-semibold text-[13px] cursor-pointer flex items-center gap-1.5"
        >
          Pro
          <span className="text-[12px]">▼</span>
        </button>

        {showMenu && (
          <div
            ref={menuRef}
            className="agendex-popover agendex-popover--enter absolute top-full right-0 mt-1 rounded-default min-w-[200px] z-[1000]"
          >
            <div className="py-3 px-4 border-b border-border text-[13px]">
              {cancelAtPeriodEnd ? (
                <div>
                  <div className="text-secondary mb-1">Canceling</div>
                  <div className="text-text font-semibold">Active until {endDate}</div>
                </div>
              ) : (
                <div>
                  <div className="text-secondary mb-1">Renews {endDate}</div>
                  <div className="text-text font-semibold">
                    {subscription.plan === 'monthly' ? 'Monthly' : 'Annual'}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={async () => {
                setShowMenu(false);
                await createPortal();
              }}
              className="w-full py-2.5 px-4 border-none bg-transparent text-text text-left cursor-pointer text-[14px] transition-[background-color] duration-200 hover:bg-hover"
            >
              Manage Billing
            </button>

            {cancelAtPeriodEnd && (
              <button
                type="button"
                onClick={async () => {
                  setShowMenu(false);
                  await reactivate();
                }}
                className="w-full py-2.5 px-4 border-0 border-t border-solid border-border bg-transparent text-left cursor-pointer text-[14px] font-semibold transition-[background-color] duration-200 hover:bg-hover"
                style={{ color: 'var(--primary)' }}
              >
                Reactivate
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div key="subscription-upgrade" className="agendex-topbar-control">
        <button
          type="button"
          onClick={() => setShowPricing(true)}
          className="subscription-pill py-2 px-3 rounded-default text-[13px] font-semibold cursor-pointer"
        >
          Upgrade to Pro
        </button>
      </div>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </>
  );
}
