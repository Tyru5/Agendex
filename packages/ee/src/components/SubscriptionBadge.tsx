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
  if (isLoading) return <Skeleton width="96px" height="34px" borderRadius="var(--radius)" />;

  if (isTrialing) {
    return (
      <>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="py-2 px-3 rounded-default font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
            style={{
              background:
                'linear-gradient(135deg, rgba(200, 255, 50, 0.12), rgba(200, 255, 50, 0.06))',
              color: '#c8ff32',
              border: '1px solid rgba(200, 255, 50, 0.2)',
            }}
          >
            Trial · {trialDaysLeft}d left
            <span className="text-[11px] opacity-70">▼</span>
          </button>

          {showMenu && (
            <div
              ref={menuRef}
              className="absolute top-full right-0 mt-1 bg-surface border border-border rounded-default min-w-[220px] z-[1000]"
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
                className="w-full py-2.5 px-4 border-none bg-transparent text-[#c8ff32] text-left cursor-pointer text-[14px] font-semibold transition-[background] duration-200 hover:bg-hover"
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
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowMenu(!showMenu)}
          className="border-none py-2 px-3 rounded-default font-semibold text-[14px] cursor-pointer flex items-center gap-1.5 text-white"
          style={{ background: 'var(--primary)' }}
        >
          Pro
          <span className="text-[12px]">▼</span>
        </button>

        {showMenu && (
          <div
            ref={menuRef}
            className="absolute top-full right-0 mt-1 bg-surface border border-border rounded-default min-w-[200px] z-[1000]"
          >
            <div className="py-3 px-4 border-b border-border text-[13px]">
              {cancelAtPeriodEnd ? (
                <div>
                  <div className="text-(--text-secondary) mb-1">Canceling</div>
                  <div className="text-text font-semibold">Active until {endDate}</div>
                </div>
              ) : (
                <div>
                  <div className="text-(--text-secondary) mb-1">Renews {endDate}</div>
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
              className="w-full py-2.5 px-4 border-none bg-transparent text-text text-left cursor-pointer text-[14px] transition-[background] duration-200 hover:bg-hover"
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
                className="w-full py-2.5 px-4 border-0 border-t border-solid border-border bg-transparent text-left cursor-pointer text-[14px] font-semibold transition-[background] duration-200 hover:bg-hover"
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
      <button
        type="button"
        onClick={() => setShowPricing(true)}
        className="bg-border text-text border-none py-2 px-3 rounded-default text-[14px] cursor-pointer"
      >
        Upgrade to Pro
      </button>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </>
  );
}
