import { useEffect, useMemo, useState } from 'react';

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

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return true;
    const platform = (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
    return /Mac|iPhone|iPad/i.test(platform);
  }, []);

  useEffect(() => {
    if (planCount > 0) return;
    setTimedOut(false);
    const id = setTimeout(() => setTimedOut(true), SYNC_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [planCount]);

  if (planCount > 0) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center text-center max-w-[360px] p-6 gap-3">
          <p className="text-[14px] text-secondary m-0 font-medium">
            Select a plan from the sidebar
          </p>
          <p className="text-[12px] text-tertiary m-0">
            or press{' '}
            <kbd className="text-[10.5px] font-semibold py-0.5 px-1.5 rounded-[5px] bg-hover border border-border text-tertiary font-[inherit]">
              {isMac ? '\u2318' : 'Ctrl'}+K
            </kbd>{' '}
            to search
          </p>
        </div>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center text-center max-w-[400px] p-6 gap-3.5">
          <div className="text-tertiary mb-0.5">
            <CloudSyncIcon />
          </div>
          <h2 className="text-[17px] font-semibold text-text m-0 tracking-[-0.02em]">
            No plans found
          </h2>
          <p className="text-[13px] text-tertiary m-0 leading-[1.6]">
            Run{' '}
            <code className="text-[12px] py-0.5 px-[7px] rounded-[5px] bg-hover border border-border font-[var(--font-mono,monospace)]">
              agendex daemon
            </code>{' '}
            to sync plans from your machine.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="flex flex-col items-center text-center max-w-[400px] p-6 gap-3.5">
        <div className="text-[#f59e0b] mb-0.5">
          <CloudSyncIcon pulse />
        </div>
        <h2 className="text-[17px] font-semibold text-text m-0 tracking-[-0.02em]">
          Syncing your plans...
        </h2>
        <p className="text-[13px] text-tertiary m-0 leading-[1.6]">
          Your plans will appear as the CLI syncs them.
        </p>
      </div>
    </div>
  );
}
