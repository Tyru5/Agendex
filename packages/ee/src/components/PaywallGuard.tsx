import type { ReactNode } from 'react';
import { useState } from 'react';
import { useSubscription } from '../hooks/useSubscription';
import { PricingModal } from './PricingModal';
import { SkeletonBlock } from '@agendex/app/src/client/components/Skeleton';

interface PaywallGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
  onBack?: () => void;
}

const PRO_HIGHLIGHTS = [
  { icon: 'cloud', label: 'Cloud sync via CLI' },
  { icon: 'share', label: 'Shareable plan links' },
  { icon: 'comment', label: 'Comment threads' },
  { icon: 'devices', label: 'Access from any device' },
  { icon: 'graph', label: 'Technology dependency charts' },
  { icon: 'history', label: 'Version history & diffs' },
  { icon: 'tag', label: 'Tags & collections' },
];

function FeatureIcon({ type }: { type: string }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (type) {
    case 'cloud':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      );
    case 'share':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" x2="12" y1="2" y2="15" />
        </svg>
      );
    case 'comment':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
      );
    case 'devices':
      return (
        <svg aria-hidden="true" {...props}>
          <rect width="20" height="14" x="2" y="3" rx="2" />
          <line x1="8" x2="16" y1="21" y2="21" />
          <line x1="12" x2="12" y1="17" y2="21" />
        </svg>
      );
    case 'graph':
      return (
        <svg aria-hidden="true" {...props}>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="19" r="2" />
          <circle cx="19" cy="12" r="2" />
          <line x1="7" y1="11" x2="10" y2="6" />
          <line x1="7" y1="13" x2="10" y2="18" />
          <line x1="14" y1="5" x2="17" y2="11" />
          <line x1="14" y1="19" x2="17" y2="13" />
        </svg>
      );
    case 'history':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
      );
    case 'tag':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
          <path d="M7 7h.01" />
        </svg>
      );
    default:
      return null;
  }
}

export function PaywallGuard({ children, fallback, onBack }: PaywallGuardProps) {
  const { isActive, isLoading } = useSubscription();
  const [showModal, setShowModal] = useState(false);

  if (isLoading) {
    return (
      <div style={{ padding: '24px' }}>
        <SkeletonBlock lines={4} />
      </div>
    );
  }

  if (!isActive) {
    return (
      <>
        {fallback || (
          <div className="paywall-guard">
            {onBack && (
              <button
                onClick={onBack}
                className="paywall-guard-back"
                type="button"
                aria-label="Go back"
              >
                <svg
                  aria-hidden="true"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>Back</span>
              </button>
            )}
            <div className="paywall-guard-glow" />

            <div className="paywall-guard-content">
              <div className="paywall-guard-badge">Pro</div>

              <h3 className="paywall-guard-title">Unlock Cloud Pro</h3>

              <p className="paywall-guard-desc">
                Create plans, sync across devices, and collaborate with your team.
              </p>

              <div className="paywall-guard-features">
                {PRO_HIGHLIGHTS.map((f) => (
                  <div key={f.icon} className="paywall-guard-feature">
                    <span className="paywall-guard-feature-icon">
                      <FeatureIcon type={f.icon} />
                    </span>
                    <span>{f.label}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowModal(true)}
                className="paywall-guard-cta"
                type="button"
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
          </div>
        )}
        {showModal && <PricingModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  return <>{children}</>;
}
