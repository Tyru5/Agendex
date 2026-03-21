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
      style={{ width: '14px', height: '14px', opacity: 0.9 }}
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
  onOpenInSplitView: (plan: Plan) => void;
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
      className="grid items-center min-w-0"
      style={{
        gridColumn: '1 / -1',
        height: `${height}px`,
        columnGap: '12px',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        boxSizing: 'border-box',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        zIndex: 50,
      }}
    >
      <div
        className="flex items-center gap-3 min-w-0 h-full overflow-hidden"
        style={{
          boxSizing: 'border-box',
          paddingLeft: '16px',
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
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: sidebarHidden ? 'var(--hover)' : 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SidebarToggleIcon hidden={sidebarHidden} />
          </button>
        </div>
        <span
          className="font-semibold text-sm"
          style={{ letterSpacing: '-0.02em', color: 'var(--text)', whiteSpace: 'nowrap' }}
        >
          Agendex
        </span>
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

      <div
        className="flex items-center justify-end gap-3 min-w-0 justify-self-end"
        style={{ paddingRight: '16px' }}
      >
        <ThemeToggle />
        <div
          className="hidden lg:block"
          style={{ width: '1px', height: '18px', background: 'var(--border)' }}
        />
        <span className="hidden lg:inline" style={{ fontSize: '12px', color: 'var(--tertiary)' }}>
          <strong style={{ color: 'var(--secondary)', fontWeight: 550 }}>{totalPlans}</strong> plans
        </span>
        <div
          className="hidden lg:block"
          style={{ width: '1px', height: '18px', background: 'var(--border)' }}
        />
        <span className="hidden lg:inline" style={{ fontSize: '12px', color: 'var(--tertiary)' }}>
          <strong style={{ color: 'var(--secondary)', fontWeight: 550 }}>{activeAgents}</strong>{' '}
          agents
        </span>
        <div
          className="hidden lg:block"
          style={{ width: '1px', height: '18px', background: 'var(--border)' }}
        />
        <div className="hidden lg:flex items-center gap-1.5">
          <div
            className="rounded-full status-pulse"
            style={{
              width: '6px',
              height: '6px',
              background: backendIndicator.color,
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--tertiary)' }}>
            {backendIndicator.label}
          </span>
        </div>
      </div>
    </div>
  );
}
