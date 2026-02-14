import type { ReactNode } from 'react';
import { useState } from 'react';
import { useSubscription } from '../hooks/useSubscription';
import { PricingModal } from './PricingModal';

interface PaywallGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function PaywallGuard({ children, fallback }: PaywallGuardProps) {
  const { isActive, isLoading } = useSubscription();
  const [showModal, setShowModal] = useState(false);

  if (isLoading) {
    return <>{children}</>;
  }

  if (!isActive) {
    return (
      <>
        {fallback || (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              background: 'var(--background)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 600 }}>
              Cloud Pro Required
            </h3>
            <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)' }}>
              This feature requires a Cloud Pro subscription
            </p>
            <button
              onClick={() => setShowModal(true)}
              style={{
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 'var(--radius)',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Upgrade to Pro
            </button>
          </div>
        )}
        {showModal && <PricingModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  return <>{children}</>;
}
