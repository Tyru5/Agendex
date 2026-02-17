import { useState } from 'react';
import { useSubscription } from '../hooks/useSubscription';

interface PricingModalProps {
  onClose?: () => void;
}

export function PricingModal({ onClose }: PricingModalProps) {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(false);
  const { createCheckout } = useSubscription();

  const monthlyPrice = 7;
  const yearlyPrice = 69;
  const yearlySavings = Math.round(((monthlyPrice * 12 - yearlyPrice) / (monthlyPrice * 12)) * 100);

  async function handleCheckout() {
    setLoading(true);
    try {
      await createCheckout(billingPeriod);
    } catch (err) {
      console.error('Checkout failed:', err);
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose) onClose();
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '500px',
          margin: '0 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '32px',
        }}
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            ×
          </button>
        )}

        <h2 style={{ margin: '0 0 24px 0', fontSize: '24px', fontWeight: 600 }}>
          Upgrade to Cloud Pro
        </h2>

        {/* Billing toggle */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '32px',
            background: 'var(--background)',
            padding: '4px',
            borderRadius: 'var(--radius)',
          }}
        >
          {(['monthly', 'yearly'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setBillingPeriod(period)}
              style={{
                flex: 1,
                padding: '10px 16px',
                border: 'none',
                borderRadius: 'calc(var(--radius) - 2px)',
                background: billingPeriod === period ? 'var(--surface)' : 'transparent',
                color: 'var(--text)',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 200ms',
              }}
            >
              {period === 'monthly' ? 'Monthly' : 'Yearly'}
              {period === 'yearly' && (
                <span
                  style={{
                    marginLeft: '8px',
                    background: 'var(--primary)',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  Save {yearlySavings}%
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Pricing display */}
        <div
          style={{
            background: 'var(--background)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '40px', fontWeight: 700 }}>
              ${billingPeriod === 'monthly' ? monthlyPrice : yearlyPrice}
            </span>
            <span style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>
              /{billingPeriod === 'monthly' ? 'month' : 'year'}
            </span>
          </div>
          {billingPeriod === 'yearly' && (
            <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              ${(yearlyPrice / 12).toFixed(2)}/month billed annually
            </div>
          )}
        </div>

        {/* Features */}
        <div style={{ marginBottom: '24px' }}>
          <h3
            style={{
              margin: '0 0 16px 0',
              fontSize: '14px',
              fontWeight: 600,
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
            }}
          >
            Includes
          </h3>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {[
              'Cloud plan sync from CLI',
              'Plan sharing & collaboration',
              'Comments & notes',
              'Web dashboard access',
            ].map((feature) => (
              <li key={feature} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA */}
        <button
          onClick={handleCheckout}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            fontSize: '16px',
            transition: 'opacity 200ms',
          }}
        >
          {loading ? 'Redirecting to Stripe...' : 'Get Started'}
        </button>
      </div>
    </div>
  );
}
