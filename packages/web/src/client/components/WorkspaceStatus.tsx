import { useEffect, useRef, useState } from 'react';

export function WorkspaceStatus({
  totalPlans,
  activeAgents,
  backendIndicator,
}: {
  totalPlans: number;
  activeAgents: number;
  backendIndicator: { label: string; color: string };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const attention = backendIndicator.label !== 'Live';

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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Workspace status: ${backendIndicator.label}`}
        title="Workspace status"
        className="agendex-topbar-button flex items-center gap-1.5 h-[30px] text-xs rounded-lg border border-border px-2 cursor-pointer"
        style={{ background: open ? 'var(--hover)' : 'transparent' }}
      >
        <span
          className={`size-1.5 rounded-full shadow-[0_0_0_2px_var(--surface)]${
            !attention ? ' status-pulse' : ''
          }`}
          style={{ background: backendIndicator.color }}
        />
        <span className="hidden sm:inline">{backendIndicator.label}</span>
      </button>

      {open && (
        <div
          className="agendex-popover agendex-popover--enter absolute top-full right-0 mt-2 rounded-[10px] min-w-[180px] z-[100] p-3 flex flex-col gap-2.5"
          role="dialog"
          aria-label="Workspace status"
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
            <span className="text-tertiary">Connection</span>
            <span className="flex items-center gap-1.5 text-secondary" style={{ fontWeight: 550 }}>
              <span
                className="size-1.5 rounded-full"
                style={{ background: backendIndicator.color }}
              />
              {backendIndicator.label}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
