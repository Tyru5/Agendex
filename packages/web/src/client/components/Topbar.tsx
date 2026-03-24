import { useMemo } from 'react';
import type { AgentStats, Plan } from '../lib/api.ts';
import { SIDEBAR_EXPANDED_WIDTH } from '../lib/constants.ts';
import { SearchBar } from './SearchBar.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

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
  search: string;
  onSearch: (q: string) => void;
  plans: Plan[];
  selectedPlan?: Plan;
  onSelectPlan: (plan: Plan | undefined) => void;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
  totalPlans: number;
  activeAgents: number;
  backendStatus: 'online' | 'offline' | 'checking';
  height: number;
}

export function Topbar({
  sidebarHidden,
  sidebarPinnedOpen,
  onToggleSidebar,
  search,
  onSearch,
  plans,
  selectedPlan,
  onSelectPlan,
  splitPlanId,
  onOpenInSplitView,
  totalPlans,
  activeAgents,
  backendStatus,
  height,
}: TopbarProps) {
  const backendIndicator = useMemo(() => {
    if (backendStatus === 'online') return { label: 'Live', color: '#22c55e' };
    if (backendStatus === 'checking') return { label: 'Checking', color: '#f59e0b' };
    return { label: 'Offline', color: '#ef4444' };
  }, [backendStatus]);

  return (
    <div
      className="grid items-center min-w-0 border-b border-border bg-surface z-50 gap-x-3"
      style={{
        gridColumn: '1 / -1',
        height: `${height}px`,
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
      }}
    >
      <div
        className="flex items-center gap-3 min-w-0 h-full overflow-hidden pl-4"
        style={{
          width: sidebarPinnedOpen ? `${SIDEBAR_EXPANDED_WIDTH}px` : undefined,
          flex: sidebarPinnedOpen ? '0 0 auto' : '1 1 auto',
          paddingRight: sidebarPinnedOpen ? '12px' : undefined,
          borderRight: sidebarPinnedOpen ? '1px solid var(--border)' : 'none',
        }}
      >
        <div className="shrink-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            className="w-[30px] h-[30px] rounded-lg border border-border text-text cursor-pointer flex items-center justify-center"
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
          className="font-semibold text-sm tracking-[-0.02em] text-text whitespace-nowrap bg-transparent border-none p-0 cursor-pointer"
        >
          Agendex
        </button>
      </div>

      <div className="hidden md:flex min-w-0 justify-center">
        <SearchBar
          search={search}
          onSearch={onSearch}
          plans={plans}
          selectedId={selectedPlan?.id}
          onSelectPlan={onSelectPlan}
          splitPlanId={splitPlanId}
          onOpenInSplitView={onOpenInSplitView}
        />
      </div>

      <div className="flex items-center justify-end gap-3 min-w-0 justify-self-end pr-4">
        <ThemeToggle />
        <div className="hidden lg:block w-px h-[18px] bg-border" />
        <span className="hidden lg:inline text-xs text-tertiary">
          <strong className="text-secondary font-[550]">{totalPlans}</strong> plans
        </span>
        <div className="hidden lg:block w-px h-[18px] bg-border" />
        <span className="hidden lg:inline text-xs text-tertiary">
          <strong className="text-secondary font-[550]">{activeAgents}</strong> agents
        </span>
        <div className="hidden lg:block w-px h-[18px] bg-border" />
        <div className="hidden lg:flex items-center gap-1.5">
          <div
            className="rounded-full status-pulse w-1.5 h-1.5"
            style={{
              background: backendIndicator.color,
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
          <span className="text-xs text-tertiary">{backendIndicator.label}</span>
        </div>
      </div>
    </div>
  );
}
