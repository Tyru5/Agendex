import { useEffect, useRef, useState } from 'react';
import type { DaemonDeviceInfo } from '../../hooks/useDaemonStatus';
import { formatRelativeTime } from '../../lib/formatTime';

export function MachinesIndicator({
  devices,
  aggregateStatus,
}: {
  devices: DaemonDeviceInfo[];
  aggregateStatus: 'alive' | 'stale' | 'unknown';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
  const dotColor =
    aggregateStatus === 'alive' ? '#22c55e' : aggregateStatus === 'stale' ? '#eab308' : '#71717a';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-tertiary hover:text-secondary transition-colors duration-150 cursor-pointer"
        aria-label={`Machines: ${aliveCount} of ${devices.length} online`}
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
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-13.5 0a3 3 0 0 1-3-3m3 3h13.5m-13.5 0a3 3 0 0 1 0-6m13.5 6a3 3 0 0 0 3-3m-3 3a3 3 0 0 0 0-6m3 6V6a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3v11.25"
          />
        </svg>
        <span>
          {aliveCount}/{devices.length}
        </span>
        <span
          className={`size-1.5 rounded-full shadow-[0_0_0_2px_var(--surface)]${aggregateStatus === 'alive' ? ' status-pulse' : ''}`}
          style={{ background: dotColor }}
        />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 bg-surface border border-border rounded-default min-w-[220px] z-[1000] p-3 flex flex-col gap-0"
          style={{ animation: 'statusPopoverIn 150ms ease-out' }}
        >
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
              return (
                <div
                  key={device.deviceId ?? `device-${i}`}
                  className={`flex items-center justify-between py-2 text-xs${i < devices.length - 1 ? ' border-b border-border' : ''}`}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-secondary truncate" style={{ fontWeight: 550 }}>
                      {device.hostname ?? 'Unknown'}
                    </span>
                    <span className="text-tertiary text-[11px]">
                      {device.lastSeenAt != null ? formatRelativeTime(device.lastSeenAt) : 'Never'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    <span
                      className="inline-block size-1.5 rounded-full"
                      style={{ background: isAlive ? '#22c55e' : '#eab308' }}
                    />
                    <span className={isAlive ? 'text-secondary' : 'text-tertiary'}>
                      {isAlive ? 'Online' : 'Stale'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
