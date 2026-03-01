import { useEffect, useState } from 'react';

const SYNC_TIMEOUT_MS = 15_000;

function CloudSyncIcon({ pulse }: { pulse?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={pulse ? { animation: 'cloud-sync-pulse 2s ease-in-out infinite' } : undefined}
    >
      <path d="M13 2.05A10 10 0 0 0 5.64 16.4" />
      <path d="M2 12h3l2-2" />
      <path d="M11 21.95A10 10 0 0 0 18.36 7.6" />
      <path d="M22 12h-3l-2 2" />
    </svg>
  );
}

interface CloudEmptyStateProps {
  planCount: number;
}

export function CloudEmptyState({ planCount }: CloudEmptyStateProps) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (planCount > 0) return;
    setTimedOut(false);
    const id = setTimeout(() => setTimedOut(true), SYNC_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [planCount]);

  if (planCount > 0) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: '360px',
            padding: '24px',
            gap: '12px',
          }}
        >
          <p style={{ fontSize: '14px', color: 'var(--secondary)', margin: 0, fontWeight: 500 }}>
            Select a plan from the sidebar
          </p>
          <p style={{ fontSize: '12px', color: 'var(--tertiary)', margin: 0 }}>
            or press{' '}
            <kbd
              style={{
                fontSize: '10.5px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '5px',
                background: 'var(--hover)',
                border: '1px solid var(--border)',
                color: 'var(--tertiary)',
                fontFamily: 'inherit',
              }}
            >
              {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
                ? '\u2318'
                : 'Ctrl'}
              +K
            </kbd>{' '}
            to search
          </p>
        </div>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: '400px',
            padding: '24px',
            gap: '14px',
          }}
        >
          <div style={{ color: 'var(--tertiary)', marginBottom: '2px' }}>
            <CloudSyncIcon />
          </div>
          <h2
            style={{
              fontSize: '17px',
              fontWeight: 600,
              color: 'var(--text)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            No plans found
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--tertiary)', margin: 0, lineHeight: 1.6 }}>
            Run{' '}
            <code
              style={{
                fontSize: '12px',
                padding: '2px 7px',
                borderRadius: '5px',
                background: 'var(--hover)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              agendex daemon
            </code>{' '}
            to sync plans from your machine.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: '400px',
          padding: '24px',
          gap: '14px',
        }}
      >
        <div style={{ color: '#f59e0b', marginBottom: '2px' }}>
          <CloudSyncIcon pulse />
        </div>
        <h2
          style={{
            fontSize: '17px',
            fontWeight: 600,
            color: 'var(--text)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          Syncing your plans...
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--tertiary)', margin: 0, lineHeight: 1.6 }}>
          Your plans will appear as the CLI syncs them.
        </p>
      </div>
    </div>
  );
}
