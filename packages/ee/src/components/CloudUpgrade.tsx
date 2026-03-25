import { useState } from 'react';
import { PricingModal } from './PricingModal';

const CLOUD_FEATURES = [
  {
    icon: 'sync',
    title: 'Cloud sync',
    desc: 'Push plans from any machine via CLI daemon',
  },
  {
    icon: 'link',
    title: 'Shareable links',
    desc: 'Send a link, anyone can view your plan',
  },
  {
    icon: 'thread',
    title: 'Comment threads',
    desc: 'Collaborate inline on any plan section',
  },
  {
    icon: 'devices',
    title: 'Any device',
    desc: 'Access your plans from anywhere, no server needed',
  },
];

function CloudFeatureIcon({ type }: { type: string }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (type) {
    case 'sync':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M21.5 2v6h-6" />
          <path d="M2.5 22v-6h6" />
          <path d="M2.5 11.5a10 10 0 0 1 16.5-5.5L21.5 8" />
          <path d="M21.5 12.5a10 10 0 0 1-16.5 5.5L2.5 16" />
        </svg>
      );
    case 'link':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'thread':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.5" />
        </svg>
      );
    case 'devices':
      return (
        <svg aria-hidden="true" {...props}>
          <rect width="18" height="12" x="3" y="4" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    default:
      return null;
  }
}

export function CloudUpgrade() {
  const [showPricing, setShowPricing] = useState(false);

  return (
    <>
      <div className="cloud-upgrade">
        <div className="cloud-upgrade-grid" />
        <div className="cloud-upgrade-glow" />
        <div className="cloud-upgrade-glow-b" />

        <div className="cloud-upgrade-inner">
          {/* Cloud icon with lock */}
          <div className="cloud-upgrade-icon-wrap">
            <svg aria-hidden="true" className="cloud-upgrade-cloud" viewBox="0 0 64 48" fill="none">
              <path
                d="M52 38H16a14 14 0 0 1-1.3-27.95A18 18 0 0 1 49 16a12 12 0 0 1 3 22Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <div className="cloud-upgrade-lock">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="11"
                  width="18"
                  height="11"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M7 11V7a5 5 0 0 1 10 0v4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          <div className="cloud-upgrade-label">Pro</div>

          <h2 className="cloud-upgrade-title">Cloud mode requires Pro</h2>

          <p className="cloud-upgrade-desc">
            Sync plans across machines, share with your team, and access everything from any device.
          </p>

          <div className="cloud-upgrade-features">
            {CLOUD_FEATURES.map((f) => (
              <div key={f.icon} className="cloud-upgrade-feature">
                <span className="cloud-upgrade-feature-icon">
                  <CloudFeatureIcon type={f.icon} />
                </span>
                <div>
                  <span className="cloud-upgrade-feature-title">{f.title}</span>
                  <span className="cloud-upgrade-feature-desc">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="cloud-upgrade-actions">
            <button
              type="button"
              className="cloud-upgrade-cta"
              onClick={() => setShowPricing(true)}
            >
              <span>Upgrade to Pro</span>
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="cloud-upgrade-price-hint">
            Starting at <strong>$7/mo</strong> &middot; Cancel anytime
          </div>
        </div>
      </div>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </>
  );
}
