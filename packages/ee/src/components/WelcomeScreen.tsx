import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';

interface WelcomeScreenProps {
  onComplete: () => void;
}

const TRIAL_FEATURES = [
  {
    icon: 'cloud',
    title: 'Cloud sync',
    desc: 'Push & pull plans from any machine',
  },
  {
    icon: 'share',
    title: 'Share links',
    desc: 'One-click shareable plan URLs',
  },
  {
    icon: 'comment',
    title: 'Comments',
    desc: 'Inline threads on any section',
  },
  {
    icon: 'history',
    title: 'Version history',
    desc: 'Diffs and rollbacks for every plan',
  },
  {
    icon: 'graph',
    title: 'Tech charts',
    desc: 'Dependency graphs, auto-generated',
  },
  {
    icon: 'tag',
    title: 'Tags & collections',
    desc: 'Organize plans your way',
  },
];

function WelcomeIcon({ type }: { type: string }) {
  const props = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
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
    case 'history':
      return (
        <svg aria-hidden="true" {...props}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
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

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const { user } = useAuth();
  const { startTrial, skipTrial } = useSubscription();
  const [loading, setLoading] = useState<'trial' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  async function handleStartTrial() {
    setLoading('trial');
    setError(null);
    try {
      await startTrial();
      onComplete();
    } catch {
      setLoading(null);
      setError('Failed to start trial. Please try again.');
    }
  }

  async function handleSkip() {
    setLoading('skip');
    setError(null);
    try {
      await skipTrial();
      onComplete();
    } catch {
      setLoading(null);
      setError('Something went wrong. Please try again.');
    }
  }

  return (
    <div className="welcome-screen">
      <div className="welcome-noise" />
      <div className="welcome-glow" />
      <div className="welcome-glow-b" />

      <div className="welcome-content">
        {user?.image && <img src={user.image} alt="" className="welcome-avatar" />}

        <div className="welcome-badge">Welcome</div>

        <h1 className="welcome-title">Hey {firstName}</h1>

        <p className="welcome-desc">
          Your account is ready. Try every Pro feature free for 7 days — no card required.
        </p>

        <div className="welcome-features">
          {TRIAL_FEATURES.map((f) => (
            <div key={f.icon} className="welcome-feature">
              <span className="welcome-feature-icon">
                <WelcomeIcon type={f.icon} />
              </span>
              <div className="welcome-feature-text">
                <span className="welcome-feature-title">{f.title}</span>
                <span className="welcome-feature-desc">{f.desc}</span>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="welcome-cta"
          onClick={handleStartTrial}
          disabled={loading !== null}
        >
          {loading === 'trial' ? (
            <span className="welcome-cta-loading">Starting trial…</span>
          ) : (
            <>
              <span>Start 7-day free trial</span>
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
            </>
          )}
        </button>

        <button
          type="button"
          className="welcome-skip"
          onClick={handleSkip}
          disabled={loading !== null}
        >
          {loading === 'skip' ? 'Setting up…' : 'Continue with free plan'}
        </button>

        {error && <p className="welcome-error" style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>{error}</p>}

        <p className="welcome-fine-print">No credit card needed · Cancel anytime</p>
      </div>
    </div>
  );
}
