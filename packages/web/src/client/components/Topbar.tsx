import { formatForDisplay } from '@tanstack/react-hotkeys';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { SIDEBAR_DEFAULT_WIDTH } from '../hooks/useSidebarWidth.ts';
import type { Plan } from '../lib/api.ts';
import { SearchBar } from './SearchBar.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { WorkspaceStatus } from './WorkspaceStatus.tsx';

function SidebarToggleIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.2}
      stroke="currentColor"
      className="w-[14px] h-[14px] opacity-90"
    >
      {hidden ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="m9.5 6.5 5 5.5-5 5.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 6.5-5 5.5 5 5.5" />
      )}
    </svg>
  );
}

interface TopbarProps {
  sidebarHidden: boolean;
  sidebarPinnedOpen: boolean;
  onToggleSidebar: () => void;
  onSelectPlan: (plan: Plan | undefined) => void;
  onFocusSearch?: () => void;
  totalPlans: number;
  activeAgents: number;
  backendStatus: 'online' | 'offline' | 'checking';
  height: number;
  sidebarWidth?: number;
  /** Extra controls rendered in the right cluster, before theme and status. */
  actions?: ReactNode;
}

export function Topbar({
  sidebarHidden,
  sidebarPinnedOpen,
  onToggleSidebar,
  onSelectPlan,
  onFocusSearch,
  totalPlans,
  activeAgents,
  backendStatus,
  height,
  sidebarWidth: sidebarWidthProp,
  actions,
}: TopbarProps) {
  const shortcutLabel = formatForDisplay('Mod+B');

  const backendIndicator = useMemo(() => {
    if (backendStatus === 'online') return { label: 'Live', color: 'var(--success)' };
    if (backendStatus === 'checking') return { label: 'Checking', color: 'var(--warning)' };
    return { label: 'Offline', color: 'var(--danger)' };
  }, [backendStatus]);

  return (
    <div
      className="agendex-topbar grid items-center min-w-0 border-b border-border z-50 gap-x-3"
      style={{
        gridColumn: '1 / -1',
        height: `${height}px`,
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
      }}
    >
      <div
        className="flex items-center gap-3 min-w-0 h-full overflow-hidden pl-4"
        style={{
          width: sidebarPinnedOpen ? `${sidebarWidthProp ?? SIDEBAR_DEFAULT_WIDTH}px` : undefined,
          flex: sidebarPinnedOpen ? '0 0 auto' : '1 1 auto',
          paddingRight: sidebarPinnedOpen ? '12px' : undefined,
          borderRight: sidebarPinnedOpen ? '1px solid var(--border)' : 'none',
        }}
      >
        <div className="shrink-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={`${sidebarHidden ? 'Show' : 'Hide'} sidebar (${shortcutLabel})`}
            title={`${sidebarHidden ? 'Show' : 'Hide'} sidebar (${shortcutLabel})`}
            className="agendex-topbar-button w-[30px] h-[30px] rounded-lg border border-border cursor-pointer flex items-center justify-center"
            style={{
              background: sidebarHidden ? 'var(--hover)' : 'transparent',
            }}
          >
            <SidebarToggleIcon hidden={sidebarHidden} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onSelectPlan(undefined)}
          className="text-[14px] font-bold tracking-[-0.01em] text-text whitespace-nowrap select-none bg-transparent border-none p-0 cursor-pointer"
        >
          Agendex<span className="agendex-brand-mark">.</span>
        </button>
      </div>

      <div className="hidden md:flex min-w-0 justify-center">
        <SearchBar onFocusSearch={onFocusSearch} />
      </div>

      <div className="flex items-center justify-end gap-1.5 min-w-0 justify-self-end pr-4">
        {actions}
        <ThemeToggle />
        <div className="w-px h-4 bg-border mx-0.5" />
        <WorkspaceStatus
          totalPlans={totalPlans}
          activeAgents={activeAgents}
          backendIndicator={backendIndicator}
        />
      </div>
    </div>
  );
}
