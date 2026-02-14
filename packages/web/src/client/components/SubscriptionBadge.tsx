import { useState, useRef, useEffect } from 'react';
import { useSubscription } from '../hooks/useSubscription';
import { useAuth } from '../hooks/useAuth';
import { PricingModal } from './PricingModal';
import { Skeleton } from './Skeleton';

export function SubscriptionBadge() {
  const { subscription, isActive, isLoading, createPortal, reactivate } = useSubscription();
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

  if (isActive && subscription) {
    const cancelAtPeriodEnd = subscription.cancelAtPeriodEnd;
    const endDate = new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={{
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            padding: '8px 12px',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          ⭐ Pro
          <span style={{ fontSize: '12px' }}>▼</span>
        </button>

        {showMenu && (
          <div
            ref={menuRef}
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              minWidth: '200px',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: '13px',
              }}
            >
              {cancelAtPeriodEnd ? (
                <div>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Canceling
                  </div>
                  <div style={{ color: 'var(--text)', fontWeight: 600 }}>
                    Active until {endDate}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Renews {endDate}
                  </div>
                  <div style={{ color: 'var(--text)', fontWeight: 600 }}>
                    {subscription.plan === 'monthly' ? 'Monthly' : 'Annual'}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={async () => {
                setShowMenu(false);
                await createPortal();
              }}
              style={{
                width: '100%',
                padding: '10px 16px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text)',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'background 200ms',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--background)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              💳 Manage Billing
            </button>

            {cancelAtPeriodEnd && (
              <button
                onClick={async () => {
                  setShowMenu(false);
                  await reactivate();
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  border: 'none',
                  borderTop: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--primary)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                  transition: 'background 200ms',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--background)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                ↻ Reactivate
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
        onClick={() => setShowPricing(true)}
        style={{
          background: 'var(--border)',
          color: 'var(--text)',
          border: 'none',
          padding: '8px 12px',
          borderRadius: 'var(--radius)',
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        Upgrade to Pro
      </button>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </>
  );
}
