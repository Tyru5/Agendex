import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { DaemonDeviceInfo } from '../../hooks/useDaemonStatus';
import { useDesktopUpdate } from '../../hooks/useDesktopUpdate.ts';
import { getDesktopBridgeIdentity, isDesktop, type UpdateState } from '../../lib/desktop.ts';
import { formatRelativeTime } from '../../lib/formatTime';

const UPDATE_STATE_EVENT = 'agendex:update:state';

function getUpdateLabel(status: UpdateState['status']): string {
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
    case 'unsupported':
      return 'Updates unavailable';
    default:
      return 'Updates';
  }
}

function getUpdateColor(status: UpdateState['status']): string {
  switch (status) {
    case 'ready':
      return 'var(--accent)';
    case 'downloading':
      return 'var(--warning)';
    case 'error':
      return 'var(--danger)';
    default:
      return 'var(--tertiary)';
  }
}

export function SystemStatusMenu({
  backendIndicator,
  totalPlans,
  activeAgents,
  devices,
  aggregateStatus,
}: {
  backendIndicator: { label: string; color: string };
  totalPlans: number;
  activeAgents: number;
  devices: DaemonDeviceInfo[];
  aggregateStatus: 'alive' | 'stale' | 'unknown';
}) {
  const [open, setOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { state: updateState, checkForUpdates, installUpdate } = useDesktopUpdate();
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    const bridge = getDesktopBridgeIdentity();
    if (!bridge) return;
    let mounted = true;
    void bridge.getAppVersion().then((v) => {
      if (mounted) setAppVersion(v);
    });
    return () => {
      mounted = false;
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    const handler = (event: CustomEvent<UpdateState>) => {
      const next = event.detail;
      if (next.status === 'ready' && updateState.status !== 'ready') {
        toast('Update ready', {
          description: `Agendex ${next.version ?? 'latest'} has downloaded. Restart to install.`,
          action: { label: 'Install now', onClick: () => installUpdate() },
        });
      }
    };
    window.addEventListener(UPDATE_STATE_EVENT, handler as EventListener);
    return () => window.removeEventListener(UPDATE_STATE_EVENT, handler as EventListener);
  }, [desktop, updateState.status, installUpdate]);

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

  const aliveCount = devices.filter((d) => d.status === 'alive').length;
  const machinesAttention = aggregateStatus !== 'alive';
  const updateAttention =
    desktop &&
    (updateState.status === 'ready' ||
      updateState.status === 'downloading' ||
      updateState.status === 'error');
  const backendAttention = backendIndicator.label !== 'Live';
  const attention = machinesAttention || updateAttention || backendAttention;

  const attentionColor = updateAttention
    ? getUpdateColor(updateState.status)
    : backendAttention
      ? backendIndicator.color
      : machinesAttention
        ? aggregateStatus === 'stale'
          ? 'var(--warning)'
          : 'var(--tertiary)'
        : backendIndicator.color;

  const triggerLabel = updateAttention
    ? getUpdateLabel(updateState.status)
    : backendAttention
      ? backendIndicator.label
      : machinesAttention
        ? `${aliveCount}/${devices.length} online`
        : backendIndicator.label;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`System status: ${triggerLabel}. ${aliveCount} of ${devices.length} machines online.`}
        title="System status"
        className="agendex-topbar-button flex items-center gap-1.5 h-[30px] text-xs rounded-lg border border-border px-2 cursor-pointer"
        style={{ background: open ? 'var(--hover)' : 'transparent' }}
      >
        <span
          className={`size-1.5 rounded-full shadow-[0_0_0_2px_var(--surface)]${
            !attention ? ' status-pulse' : ''
          }`}
          style={{ background: attentionColor }}
        />
        <span className="hidden sm:inline max-w-[9rem] truncate">{triggerLabel}</span>
      </button>

      {open && (
        <div
          className="agendex-popover agendex-popover--enter absolute top-full right-0 mt-2 rounded-default min-w-[280px] max-w-[320px] z-[1000] p-3 flex flex-col gap-3"
          role="dialog"
          aria-label="System status"
        >
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-tertiary">Connection</span>
              <span
                className="flex items-center gap-1.5 text-secondary"
                style={{ fontWeight: 550 }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: backendIndicator.color }}
                />
                {backendIndicator.label}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-tertiary">Plans</span>
              <span className="text-secondary" style={{ fontWeight: 550 }}>
                {totalPlans}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-tertiary">Active agents</span>
              <span className="text-secondary" style={{ fontWeight: 550 }}>
                {activeAgents}
              </span>
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="flex flex-col gap-0">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-tertiary">Machines</span>
              <span className="text-secondary" style={{ fontWeight: 550 }}>
                {aliveCount}/{devices.length} online
              </span>
            </div>
            {devices.length === 0 ? (
              <div className="text-xs text-tertiary py-1">
                No machines connected.{' '}
                <code className="text-[11px] bg-hover px-1 py-0.5 rounded-default">
                  agendex start
                </code>
              </div>
            ) : (
              devices.map((device, i) => {
                const isAlive = device.status === 'alive';
                const lastSeen =
                  device.lastSeenAt != null ? formatRelativeTime(device.lastSeenAt) : 'Never';
                return (
                  <div
                    key={device.deviceId ?? `device-${i}`}
                    className={`flex items-start justify-between gap-4 py-2 text-xs${
                      i < devices.length - 1 ? ' border-b border-border' : ''
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-secondary truncate" style={{ fontWeight: 550 }}>
                        {device.hostname ?? 'Unknown'}
                      </span>
                      <span className="text-tertiary text-[11px]">{lastSeen}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className="inline-block size-1.5 rounded-full"
                        style={{ background: isAlive ? 'var(--success)' : 'var(--warning)' }}
                      />
                      <span className={isAlive ? 'text-secondary' : 'text-tertiary'}>
                        {isAlive ? 'Online' : 'Stale'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {desktop && (
            <>
              <div className="h-px bg-border" />
              <section className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-tertiary">App update</span>
                  <span className="text-secondary" style={{ fontWeight: 550 }}>
                    {getUpdateLabel(updateState.status)}
                  </span>
                </div>
                {appVersion && (
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-tertiary">Version</span>
                    <code className="text-[11px] font-mono bg-hover px-1.5 py-0.5 rounded">
                      {appVersion}
                    </code>
                  </div>
                )}
                {updateState.version && updateState.status !== 'no-update' && (
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-tertiary">Available</span>
                    <code className="text-[11px] font-mono bg-hover px-1.5 py-0.5 rounded">
                      {updateState.version}
                    </code>
                  </div>
                )}
                {updateState.status === 'downloading' && updateState.progress !== undefined && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${updateState.progress}%`,
                          background: 'var(--accent)',
                        }}
                      />
                    </div>
                    <span className="text-tertiary">{Math.round(updateState.progress)}%</span>
                  </div>
                )}
                {updateState.error && (
                  <div className="text-[11px] text-[var(--danger)] break-words">
                    {updateState.error}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => checkForUpdates()}
                    disabled={
                      updateState.status === 'unsupported' || updateState.status === 'checking'
                    }
                    className="flex-1 agendex-topbar-button text-[12px] py-1.5 rounded-lg border border-border cursor-pointer font-medium hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Check
                  </button>
                  {updateState.status === 'ready' && (
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
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
