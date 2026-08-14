import { useEffect, useState } from 'react';
import {
  type DesktopBuildInfo,
  getDesktopBridgeIdentity,
  type UpdateState,
} from '../../lib/desktop.ts';
import { useDesktopUpdate } from '../../hooks/useDesktopUpdate.ts';
import { useDesktopUiUpdate } from '../../hooks/useDesktopUiUpdate.ts';

/**
 * UI bundle revisions are the git commit timestamp they were built from, which
 * is meaningless to read as a number — show the date instead.
 */
function formatUiRevision(revision: number | null): string {
  if (revision === null) return '—';
  if (revision === 0) return 'Shipped with app';
  return new Date(revision * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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
    case 'unsupported':
      return 'Automatic updates unavailable';
    default:
      return 'Not checked yet';
  }
}

export function UpdateTab() {
  const { state, checkForUpdates, installUpdate } = useDesktopUpdate();
  const {
    state: uiState,
    revision: uiRevision,
    version: uiVersion,
    checkForUiUpdates,
    applyUiUpdate,
  } = useDesktopUiUpdate();
  const [appVersion, setAppVersion] = useState<string>('—');
  const [buildInfo, setBuildInfo] = useState<DesktopBuildInfo | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridgeIdentity();
    if (!bridge) return;
    let mounted = true;

    void bridge.getAppVersion().then((v) => {
      if (mounted) setAppVersion(v);
    });
    void bridge.getBuildInfo().then((info) => {
      if (mounted) setBuildInfo(info);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const { status, version, progress, error } = state;
  const isReady = status === 'ready';
  const isDownloading = status === 'downloading';
  const isUnsupported = status === 'unsupported';
  // Only ever true on a packaged Windows build with no certificate; every other
  // case resolves to null (unknown) and shows nothing.
  const isUnsignedBuild = buildInfo?.codeSigned === false;

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
        {isUnsignedBuild && (
          <>
            <div className="flex items-center justify-between text-[13px] mt-2">
              <span className="text-tertiary">Code signing</span>
              <span className="font-medium text-text">Not signed yet</span>
            </div>
            <p className="mt-3 mb-0 text-[12px] leading-[1.6] text-tertiary">
              This Windows build carries no code-signing certificate, so Windows SmartScreen flags
              the publisher as unknown when you first run the installer. A signing certificate is
              planned; this notice disappears on its own once signed builds ship. Everything else,
              including updates, works normally.
            </p>
          </>
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

        {isUnsupported && (
          <div className="text-[12px] text-tertiary break-words mb-4">
            This build cannot update itself. Download the latest version from{' '}
            <span className="font-mono">agendex.dev/download</span>.
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={checkForUpdates}
            disabled={status === 'checking' || isUnsupported}
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

      {/* Interface updates: shipped independently of the app, so they apply with
          a reload instead of a reinstall. */}
      {uiState.status !== 'unsupported' && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h3 className="text-[14px] font-semibold text-text mb-4">Interface</h3>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-tertiary">Current version</span>
            <code className="font-mono text-[12px] bg-hover px-2 py-0.5 rounded">
              {uiVersion && uiVersion !== 'shipped' ? uiVersion : formatUiRevision(uiRevision)}
            </code>
          </div>

          <div className="flex items-center gap-3 mt-4 mb-4">
            <StatusDot status={uiState.status} />
            <span className="text-[13px] text-text font-medium">
              {uiState.status === 'ready'
                ? 'Interface update ready — reload to apply'
                : uiState.status === 'downloading'
                  ? 'Downloading interface update…'
                  : uiState.status === 'checking'
                    ? 'Checking for interface updates…'
                    : uiState.status === 'no-update'
                      ? 'Interface is up to date'
                      : uiState.status === 'error'
                        ? 'Interface update error'
                        : 'Not checked yet'}
            </span>
          </div>

          {uiState.status === 'downloading' && uiState.progress !== undefined && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-[12px] text-tertiary mb-1">
                <span>Downloading…</span>
                <span>{Math.round(uiState.progress)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${uiState.progress}%`, background: 'var(--accent)' }}
                />
              </div>
            </div>
          )}

          {uiState.error && (
            <div className="text-[12px] text-[var(--danger,#ff4757)] break-words mb-4">
              {uiState.error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={checkForUiUpdates}
              disabled={uiState.status === 'checking' || uiState.status === 'downloading'}
              className="agendex-topbar-button text-[13px] px-4 py-2 rounded-lg border border-border cursor-pointer font-medium hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uiState.status === 'checking' ? 'Checking…' : 'Check for Interface Updates'}
            </button>
            {uiState.status === 'ready' && (
              <button
                type="button"
                onClick={applyUiUpdate}
                className="agendex-topbar-primary text-[13px] px-4 py-2 rounded-lg cursor-pointer font-semibold"
              >
                Reload Now
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
