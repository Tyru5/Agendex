import { useState } from 'react';
import { useSubscription } from '../hooks/useSubscription';

interface PricingModalProps {
  onClose?: () => void;
}

const FREE_FEATURES = [
  'Local plan indexing & search',
  'All agent adapters',
  'Full source access',
  'No accounts required',
];

const PRO_FEATURES = [
  'Everything in Self-Hosted',
  'Cloud sync via CLI daemon',
  'Shareable plan links',
  'Comment threads',
  'Tags, collections & plan history',
  'Technology dependency charts',
  'Plannotator integration',
  'New plan tracking & indicators',
  'Plan creation from dashboard',
  'Up to 5 workspace members',
  'Access from any device',
  '...and more!',
];

function ArrowRight() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
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
    } catch {
      setLoading(false);
    }
  }

  return (
    <div
      className="pricing-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose) onClose();
      }}
    >
      <div className="pricing-modal">
        {onClose && (
          <button
            type="button"
            className="pricing-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        )}

        <div className="pricing-modal-header">
          <h2 className="pricing-modal-title">Run it your way.</h2>
          <p className="pricing-modal-subtitle">
            Self-host for free or upgrade for cloud sync, sharing & collaboration.
          </p>
        </div>

        <div className="pricing-toggle-wrap">
          <div className="pricing-toggle">
            <div className="pricing-toggle-pill" data-active={billingPeriod} />
            <button
              className="pricing-toggle-btn"
              data-selected={billingPeriod === 'monthly' ? 'true' : 'false'}
              onClick={() => setBillingPeriod('monthly')}
              type="button"
            >
              Monthly
            </button>
            <button
              className="pricing-toggle-btn"
              data-selected={billingPeriod === 'yearly' ? 'true' : 'false'}
              onClick={() => setBillingPeriod('yearly')}
              type="button"
            >
              Yearly
              <span className="pricing-toggle-save">-{yearlySavings}%</span>
            </button>
          </div>
        </div>

        <div className="pricing-cards">
          {/* Free tier */}
          <div className="pricing-card">
            <span className="pricing-card-badge">Free</span>
            <h3 className="pricing-card-name">Self-Hosted</h3>
            <div className="pricing-card-price">
              <span className="pricing-card-amount">$0</span>
              <span className="pricing-card-period">/forever</span>
            </div>
            <div className="pricing-card-annual-note" />
            <p className="pricing-card-desc">
              Clone the repo, run locally. Full control over your data.
            </p>
            <ul className="pricing-card-features">
              {FREE_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              className="pricing-card-cta pricing-card-cta-ghost"
            >
              GitHub
            </a>
          </div>

          {/* Pro tier */}
          <div className="pricing-card pricing-card-pro">
            <span className="pricing-card-badge pricing-card-badge-accent">Pro</span>
            <h3 className="pricing-card-name">Cloud</h3>
            <div className="pricing-card-price">
              <span className="pricing-card-amount">
                ${billingPeriod === 'monthly' ? monthlyPrice : yearlyPrice}
              </span>
              <span className="pricing-card-period">
                /{billingPeriod === 'monthly' ? 'mo' : 'yr'}
              </span>
            </div>
            <div className="pricing-card-annual-note">
              {billingPeriod === 'yearly'
                ? `$${(yearlyPrice / 12).toFixed(2)}/mo billed annually`
                : '\u00A0'}
            </div>
            <p className="pricing-card-desc">
              No setup, no servers. Install the CLI and start syncing.
            </p>
            <ul className="pricing-card-features">
              {PRO_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button
              className="pricing-card-cta pricing-card-cta-primary"
              onClick={handleCheckout}
              disabled={loading}
              type="button"
            >
              {loading ? 'Redirecting…' : 'Get Started'}
              {!loading && <ArrowRight />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
