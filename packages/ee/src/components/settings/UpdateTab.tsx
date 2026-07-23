import { useEffect, useState } from 'react';
import { isDesktop, type UpdateState } from '../../lib/desktop.ts';
import { useDesktopUpdate } from '../hooks/useDesktopUpdate.ts';

function StatusDot({ status }: { status: UpdateState['status'] }) {
  const color =
    status === 'ready'
      ? 'var(--accent)'
      : status === 'downloading'
        ? 'var(--warning)'
        : status === 'error'
          ? 'var(--danger, #ff4757)'
          : status === 'checking'
            ? 'var(--tertiary)'
            : 'var(--tertiary)';
  return (
    <span
      className="size-2 rounded-full shadow-[0_0_0_2px_var(--surface)]"
      style={{ background: color }}
    />
  );
}

function StatusLabel({ status }: { status: UpdateState['status'] }) {
  switch (status) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return 'Downloading update…';
    case 'ready':
      return 'Update ready to install';
    case 'no-update':
      return 'You are up to date';
    case 'error':
      return 'Update error';
    default:
      return 'Not checked yet';
  }
}

export function UpdateTab() {
  const { state, checkForUpdates, installUpdate } = useDesktopUpdate();
  const [appVersion, setAppVersion] = useState<string>('—');

  useEffect(() => {
    if (!isDesktop()) return;
    void window.agendexDesktop.getAppVersion().then((v) => setAppVersion(v));
  }, []);

  const { status, version, progress, error } = state;
  const isReady = status === 'ready';
  const isDownloading = status === 'downloading';

  return (
    <div className="space-y-6">
      {/* Current Version */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="text-[14px] font-semibold text-text mb-4">Application</h3>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-tertiary">Current version</span>
          <code className="font-mono text-[12px] bg-hover px-2 py-0.5 rounded">{appVersion}</code>
        </div>
        {version && status !== 'no-update' && (
          <div className="flex items-center justify-between text-[13px] mt-2">
            <span className="text-tertiary">Available version</span>
            <code className="font-mono text-[12px] bg-hover px-2 py-0.5 rounded">{version}</code>
          </div>
        )}
      </div>

      {/* Update Status */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="text-[14px] font-semibold text-text mb-4">Update Status</h3>
        <div className="flex items-center gap-3 mb-4">
          <StatusDot status={status} />
          <span className="text-[13px] text-text font-medium">
            <StatusLabel status={status} />
          </span>
        </div>

        {isDownloading && progress !== undefined && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-[12px] text-tertiary mb-1">
              <span>Downloading…</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: 'var(--accent)' }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="text-[12px] text-[var(--danger,#ff4757)] break-words mb-4">{error}</div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={checkForUpdates}
            disabled={status === 'checking'}
            className="agendex-topbar-button text-[13px] px-4 py-2 rounded-lg border border-border cursor-pointer font-medium hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'checking' ? 'Checking…' : 'Check for Updates'}
          </button>
          {isReady && (
            <button
              type="button"
              onClick={installUpdate}
              className="agendex-topbar-primary text-[13px] px-4 py-2 rounded-lg cursor-pointer font-semibold"
            >
              Install &amp; Restart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
