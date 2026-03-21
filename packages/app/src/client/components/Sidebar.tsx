import type { AgentStats, Plan } from '../lib/api.ts';
import { SIDEBAR_EXPANDED_WIDTH } from '../lib/constants.ts';
import { startViewTransition } from '../lib/view-transition.ts';
import { PlanList } from './PlanList.tsx';
import { SidebarFilters } from './SidebarFilters.tsx';
import { SkeletonBlock } from './Skeleton.tsx';

interface SidebarProps {
  sidebarHidden: boolean;
  sidebarVisible: boolean;
  sidebarPeekOpen: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  sortBy: 'updatedAt' | 'createdAt' | 'title';
  onSortChange: (sort: 'updatedAt' | 'createdAt' | 'title') => void;
  dateBucket: 'all' | 'today' | '7d' | '30d';
  onDateBucketChange: (date: 'all' | 'today' | '7d' | '30d') => void;
  agents: AgentStats[];
  selectedAgent?: string;
  onAgentSelect: (agent: string | undefined) => void;
  filteredPlans: Plan[];
  selectedPlanId?: string;
  splitPlanId?: string;
  onSelectPlan: (plan: Plan | undefined) => void;
  onOpenInSplitView: (plan: Plan) => void;
  loading: boolean;
  error: string | null;
}

export function Sidebar({
  sidebarHidden,
  sidebarVisible,
  sidebarPeekOpen,
  onMouseEnter,
  onMouseLeave,
  sortBy,
  onSortChange,
  dateBucket,
  onDateBucketChange,
  agents,
  selectedAgent,
  onAgentSelect,
  filteredPlans,
  selectedPlanId,
  splitPlanId,
  onSelectPlan,
  onOpenInSplitView,
  loading,
  error,
}: SidebarProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-reveal sidebar container
    <div
      className="flex flex-col overflow-hidden"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        gridColumn: '1 / 2',
        gridRow: '2 / 3',
        position: sidebarHidden ? 'absolute' : 'relative',
        top: sidebarHidden ? 0 : undefined,
        left: sidebarHidden ? 0 : undefined,
        height: sidebarHidden ? '100%' : undefined,
        width: `${SIDEBAR_EXPANDED_WIDTH}px`,
        zIndex: sidebarHidden ? 45 : undefined,
        borderRight: sidebarVisible ? '1px solid var(--border)' : 'none',
        background: 'var(--surface)',
        minWidth: 0,
        opacity: sidebarHidden ? (sidebarPeekOpen ? 1 : 0) : 1,
        transform: sidebarHidden
          ? sidebarPeekOpen
            ? 'scale(1) translateY(0)'
            : 'scale(0.96) translateY(8px)'
          : 'none',
        transformOrigin: 'top left',
        willChange: sidebarPeekOpen ? 'transform, opacity' : undefined,
        pointerEvents: sidebarVisible ? 'auto' : 'none',
        boxShadow: sidebarPeekOpen ? '0 18px 40px rgba(0,0,0,0.20)' : 'none',
        transition: sidebarHidden
          ? 'transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease'
          : 'opacity 120ms ease',
      }}
    >
      <div className="px-3 pt-3 pb-2">
        <SidebarFilters
          sortBy={sortBy}
          onSortChange={onSortChange}
          dateBucket={dateBucket}
          onDateBucketChange={onDateBucketChange}
          agents={agents}
          selectedAgent={selectedAgent}
          onAgentSelect={onAgentSelect}
        />
      </div>

      <div className="flex-1 overflow-auto sidebar-scroll px-3 pb-3">
        {loading ? (
          <div className="p-4">
            <SkeletonBlock lines={5} />
          </div>
        ) : error ? (
          <div className="p-4" style={{ fontSize: '13px', color: '#ef4444' }}>
            Failed to load plans.
          </div>
        ) : (
          <PlanList
            plans={filteredPlans}
            selectedId={selectedPlanId}
            splitPlanId={splitPlanId}
            onSelect={(plan) => startViewTransition(() => onSelectPlan(plan))}
            onOpenInSplitView={onOpenInSplitView}
          />
        )}
      </div>
    </div>
  );
}
