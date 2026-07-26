import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlanFolders } from '../hooks/usePlanFolders.ts';
import { SIDEBAR_DEFAULT_WIDTH } from '../hooks/useSidebarWidth.ts';
import type { AgentStats, Plan } from '../lib/api.ts';
import { MAX_FOLDERS } from '../lib/plan-folders.ts';
import { startViewTransition } from '../lib/view-transition.ts';
import { PlanList } from './PlanList.tsx';
import type { SidebarSortBy } from './SidebarFilters.tsx';
import { SidebarFilters } from './SidebarFilters.tsx';
import { SidebarResizeHandle } from './SidebarResizeHandle.tsx';
import { SkeletonBlock } from './Skeleton.tsx';

interface SidebarProps {
  sidebarHidden: boolean;
  sidebarVisible: boolean;
  sidebarPeekOpen: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  search: string;
  onSearch: (value: string) => void;
  sortBy: SidebarSortBy;
  onSortChange: (sort: SidebarSortBy) => void;
  dateBucket: 'all' | 'today' | '7d' | '30d';
  onDateBucketChange: (date: 'all' | 'today' | '7d' | '30d') => void;
  agents: AgentStats[];
  selectedAgents: readonly string[];
  onAgentsChange: (agents: string[]) => void;
  workspace?: string;
  onWorkspaceChange?: (workspace: string | undefined) => void;
  workspaces?: readonly string[];
  onClearFilters?: () => void;
  onSearchFocusRequest?: () => void;
  filteredPlans: Plan[];
  selectedPlanId?: string;
  isPro?: boolean;
  splitPlanId?: string;
  onSelectPlan: (plan: Plan | undefined) => void;
  onOpenInSplitView?: (plan: Plan) => void;
  onRemoveCustomDir?: (dir: string) => void | Promise<void>;
  /** All configured custom plan source paths — ensures empty / file-path sources are visible. */
  customPlanDirs?: readonly string[];
  loading: boolean;
  error: string | null;
  width?: number;
  onResize?: (width: number) => void;
}

const SCROLL_TOP_PLAN_THRESHOLD = 12;
const SCROLL_TOP_OFFSET = 220;

export function Sidebar({
  sidebarHidden,
  sidebarVisible,
  sidebarPeekOpen,
  onMouseEnter,
  onMouseLeave,
  search,
  onSearch,
  sortBy,
  onSortChange,
  dateBucket,
  onDateBucketChange,
  agents,
  selectedAgents,
  onAgentsChange,
  workspace,
  onWorkspaceChange,
  workspaces,
  onClearFilters,
  onSearchFocusRequest,
  filteredPlans,
  selectedPlanId,
  isPro,
  splitPlanId,
  onSelectPlan,
  onOpenInSplitView,
  onRemoveCustomDir,
  customPlanDirs,
  loading,
  error,
  width,
  onResize,
}: SidebarProps) {
  const folderState = usePlanFolders();
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const hasManyPlans = !loading && !error && filteredPlans.length > SCROLL_TOP_PLAN_THRESHOLD;
  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedAgents.length > 0 ||
    Boolean(workspace) ||
    dateBucket !== 'all' ||
    sortBy !== 'updatedAt';

  const updateScrollTopVisibility = useCallback(
    (node: HTMLDivElement | null = scrollViewportRef.current) => {
      const hasScrollableOverflow = node ? node.scrollHeight > node.clientHeight + 120 : false;
      setShowScrollTop(
        Boolean(
          node && hasManyPlans && hasScrollableOverflow && node.scrollTop > SCROLL_TOP_OFFSET,
        ),
      );
    },
    [hasManyPlans],
  );

  useEffect(() => {
    updateScrollTopVisibility();
  }, [updateScrollTopVisibility]);

  function scrollSidebarToTop() {
    scrollViewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    // hover-reveal sidebar container
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="agendex-sidebar flex flex-col overflow-hidden bg-surface min-w-0 origin-top-left"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        gridColumn: '1 / 2',
        gridRow: '2 / 3',
        position: sidebarHidden ? 'absolute' : 'relative',
        top: sidebarHidden ? 0 : undefined,
        left: sidebarHidden ? 0 : undefined,
        height: sidebarHidden ? '100%' : undefined,
        width: `${width ?? SIDEBAR_DEFAULT_WIDTH}px`,
        zIndex: sidebarHidden ? 45 : undefined,
        borderRight: sidebarVisible ? '1px solid var(--border)' : 'none',
        opacity: sidebarHidden ? (sidebarPeekOpen ? 1 : 0) : 1,
        transform: sidebarHidden
          ? sidebarPeekOpen
            ? 'scale(1) translateY(0)'
            : 'scale(0.96) translateY(8px)'
          : 'none',
        willChange: sidebarPeekOpen ? 'transform, opacity' : undefined,
        pointerEvents: sidebarVisible ? 'auto' : 'none',
        boxShadow: sidebarPeekOpen ? '0 18px 40px rgba(0,0,0,0.20)' : 'none',
        transition: sidebarHidden
          ? 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease'
          : 'opacity 120ms ease',
      }}
    >
      {onResize && !sidebarHidden && <SidebarResizeHandle onResize={onResize} />}
      <div className="sidebar-command-zone">
        <SidebarFilters
          search={search}
          onSearch={onSearch}
          sortBy={sortBy}
          onSortChange={onSortChange}
          dateBucket={dateBucket}
          onDateBucketChange={onDateBucketChange}
          agents={agents}
          selectedAgents={selectedAgents}
          onAgentsChange={onAgentsChange}
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
          workspaces={workspaces}
          onClearAll={onClearFilters}
          onSearchFocusRequest={onSearchFocusRequest}
        />
      </div>

      <div
        ref={scrollViewportRef}
        className="flex-1 overflow-auto sidebar-scroll sidebar-content-list"
        onScroll={(event) => updateScrollTopVisibility(event.currentTarget)}
      >
        {loading ? (
          <div className="p-4">
            <SkeletonBlock lines={5} />
          </div>
        ) : error ? (
          <div className="p-4 text-[13px] text-[var(--danger)]">Failed to load plans.</div>
        ) : (
          <PlanList
            plans={filteredPlans}
            selectedId={selectedPlanId}
            isPro={isPro}
            splitPlanId={splitPlanId}
            onSelect={(plan) => startViewTransition(() => onSelectPlan(plan))}
            onOpenInSplitView={onOpenInSplitView}
            onRemoveCustomDir={onRemoveCustomDir}
            customPlanDirs={customPlanDirs}
            folderState={folderState}
            emptyState={
              onClearFilters && hasActiveFilters
                ? {
                    title: 'No plans match these filters',
                    actionLabel: 'Clear all',
                    onAction: onClearFilters,
                  }
                : undefined
            }
          />
        )}
      </div>

      {showScrollTop && (
        <button
          type="button"
          className="sidebar-scroll-top"
          onClick={scrollSidebarToTop}
          aria-label="Scroll sidebar to top"
          title="Scroll to top"
        >
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 13V3" />
            <path d="M4 7 8 3l4 4" />
          </svg>
        </button>
      )}

      {!loading && !error && folderState.folders.length === 0 && (
        <div className="px-[10px] pb-3">
          <button
            type="button"
            disabled={folderState.folderCount >= MAX_FOLDERS}
            onClick={() => folderState.createFolder('New folder')}
            className="sidebar-folder-button"
            style={{
              opacity: folderState.folderCount >= MAX_FOLDERS ? 0.4 : 1,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
            New folder
          </button>
        </div>
      )}
    </div>
  );
}
