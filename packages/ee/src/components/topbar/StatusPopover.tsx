import { useEffect, useRef, useState } from 'react';

export function StatusPopover({
  mode,
  backendIndicator,
  totalPlans,
  activeAgents,
}: {
  mode: 'local' | 'cloud';
  backendIndicator: { label: string; color: string };
  totalPlans: number;
  activeAgents: number;
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
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-tertiary hover:text-secondary transition-colors duration-150 cursor-pointer"
      >
        <span
          className="size-1.5 rounded-full status-pulse shadow-[0_0_0_2px_var(--surface)]"
          style={{ background: backendIndicator.color }}
        />
        <span>{backendIndicator.label}</span>
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          className="size-2.5 opacity-50"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms',
          }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 bg-surface border border-border rounded-default min-w-[180px] z-[1000] p-3 flex flex-col gap-2.5"
          style={{
            animation: 'statusPopoverIn 150ms ease-out',
          }}
        >
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
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between text-xs">
            <span className="text-tertiary">Mode</span>
            <span
              className="text-[11px] py-0.5 px-2 rounded border border-border bg-transparent text-secondary uppercase tracking-wide"
              style={{ fontWeight: 550 }}
            >
              {mode}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
