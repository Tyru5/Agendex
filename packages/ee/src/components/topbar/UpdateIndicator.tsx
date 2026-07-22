import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isDesktop, type UpdateState } from '../../lib/desktop.ts';
import { useDesktopUpdate } from '../hooks/useDesktopUpdate.ts';

const UPDATE_STATE_EVENT = 'agendex:update:state';

function getStatusLabel(status: UpdateState['status']): string {
  switch (status) {
    case 'checking':
      return 'Checking for updates';
    case 'downloading':
      return 'Downloading update';
    case 'ready':
      return 'Update ready';
    case 'no-update':
      return 'Up to date';
    case 'error':
      return 'Update error';
    default:
      return 'Updates';
  }
}

function getStateColor(status: UpdateState['status']): string {
  switch (status) {
    case 'ready':
      return 'var(--accent)';
    case 'downloading':
      return 'var(--warning)';
    case 'error':
      return 'var(--danger, #ff4757)';
    case 'checking':
      return 'var(--tertiary)';
    default:
      return 'var(--tertiary)';
  }
}

export function UpdateIndicator() {
  const { state, checkForUpdates, installUpdate } = useDesktopUpdate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDesktop()) return;

    const handler = (event: CustomEvent<UpdateState>) => {
      const newState = event.detail;
      if (newState.status === 'ready' && state.status !== 'ready') {
        toast('Update ready', {
          description: `Agendex ${newState.version ?? 'latest'} has downloaded. Restart to install.`,
          action: { label: 'Install now', onClick: () => installUpdate() },
        });
      }
    };

    window.addEventListener(UPDATE_STATE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(UPDATE_STATE_EVENT, handler as EventListener);
    };
  }, [state.status, installUpdate]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!isDesktop()) return null;

  const { status, version, progress, error } = state;
  const dotColor = getStateColor(status);
  const showBadge = status === 'ready' || status === 'downloading' || status === 'error';
  const showProgress = status === 'downloading' && progress !== undefined;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="agendex-topbar-button flex items-center gap-1.5 text-xs rounded-lg border border-transparent px-2 py-1.5 cursor-pointer"
        aria-label={getStatusLabel(status)}
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          className="size-3.5"
        >
          {status === 'checking' ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16V4m0 0l4 4m-4-4l-4 4"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16 16v-2.5a4 4 0 00-3-3.9V4a2 2 0 10-4 0v3.6a4 4 0 003 3.9V16m0 0h4m-4 0v2a2 2 0 104 0v-2m-4 0H9"
            />
          )}
        </svg>
        <span className="hidden sm:inline">{getStatusLabel(status)}</span>
        {showBadge && (
          <span
            className="size-1.5 rounded-full shadow-[0_0_0_2px_var(--surface)]"
            style={{ background: dotColor }}
          />
        )}
      </button>

      {open && (
        <div
          className="agendex-popover absolute top-full right-0 mt-2 rounded-default min-w-[240px] z-[1000] p-3 flex flex-col gap-3"
          style={{ animation: 'statusPopoverIn 150ms ease-out' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-tertiary">Update Status</span>
            <span className="text-[12px] font-semibold text-text">{getStatusLabel(status)}</span>
          </div>

          {version && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-tertiary">Version</span>
              <code className="text-[11px] font-mono bg-hover px-1.5 py-0.5 rounded">
                {version}
              </code>
            </div>
          )}

          {showProgress && (
            <div className="flex items-center gap-2 text-[12px]">
              <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
              <span className="text-tertiary">{Math.round(progress)}%</span>
            </div>
          )}

          {error && (
            <div className="text-[11px] text-[var(--danger,#ff4757)] break-words">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                checkForUpdates();
                setOpen(false);
              }}
              className="flex-1 agendex-topbar-button text-[12px] py-1.5 rounded-lg border border-border cursor-pointer font-medium hover:bg-hover"
            >
              Check
            </button>
            {status === 'ready' && (
              <button
                type="button"
                onClick={() => {
                  installUpdate();
                  setOpen(false);
                }}
                className="flex-1 agendex-topbar-primary text-[12px] py-1.5 rounded-lg cursor-pointer font-semibold"
              >
                Install
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
