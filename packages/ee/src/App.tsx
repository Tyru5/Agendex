import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  EmptyStateView,
  filterPlans,
  hasToken,
  LandingPage,
  OfflineView,
  PlanList,
  PlanViewer,
  SearchBar,
  SidebarFilters,
  SkeletonBlock,
  startViewTransition,
  ThemeToggle,
  useAgents,
  useBackendStatus,
  usePlans,
  useSeenPlans,
  type AgentStats,
  type Plan,
} from '@agendex/web';
import { parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from 'nuqs';
import { throttle } from 'nuqs';
import { Route, Switch, Redirect } from 'wouter';
import { AuthButton } from './components/AuthButton.tsx';
import { CliAuthPage } from './components/CliAuthPage.tsx';
import { CloudEmptyState } from './components/CloudEmptyState.tsx';
import { CloudUpgrade } from './components/CloudUpgrade.tsx';
import { OnboardingRoute } from './components/OnboardingRoute.tsx';
import { PaywallGuard } from './components/PaywallGuard.tsx';
import { PricingModal } from './components/PricingModal.tsx';
import { WelcomeScreen } from './components/WelcomeScreen.tsx';
import { SharedPlanView } from './components/SharedPlanView.tsx';
import { SubscriptionBadge } from './components/SubscriptionBadge.tsx';
import { useCloudPlans } from './hooks/useCloudPlans.ts';
import { useDaemonStatus } from './hooks/useDaemonStatus.ts';
import { useAuth } from './hooks/useAuth.ts';
import { useSubscription } from './hooks/useSubscription.ts';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { PlanTagsBar } from './components/PlanTagsBar.tsx';
import { SharePlanDialog } from './components/SharePlanDialog.tsx';

const PlanEditor = lazy(() =>
  import('@agendex/web').then((m) => ({
    default: m.PlanEditor,
  })),
);

const PlanCreator = lazy(() =>
  import('@agendex/web').then((m) => ({
    default: m.PlanCreator,
  })),
);

const PlanUploader = lazy(() =>
  import('@agendex/web').then((m) => ({
    default: m.PlanUploader,
  })),
);

const PlanHistoryDrawer = lazy(() =>
  import('./components/PlanHistoryDrawer.tsx').then((m) => ({
    default: m.PlanHistoryDrawer,
  })),
);

const SIDEBAR_EXPANDED_WIDTH = 260;
const SIDEBAR_PREF_KEY = 'agendex_sidebar_hidden';
const SIDEBAR_HOVER_ZONE_WIDTH = 14;
const TOPBAR_HEIGHT = 70;

type DashboardMode = 'local' | 'cloud';

function SidebarToggleIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.2}
      stroke="currentColor"
      className="size-3.5 opacity-90"
    >
      {hidden ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="m9.5 6.5 5 5.5-5 5.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 6.5-5 5.5 5 5.5" />
      )}
    </svg>
  );
}

const sortOptions = ['updatedAt', 'createdAt', 'title'] as const;
const dateOptions = ['all', 'today', '7d', '30d'] as const;

function useDashboardData(
  mode: DashboardMode,
  agentFilter: string | undefined,
  sortBy: string,
  dateBucket: string,
  search: string,
  selectedTags: string[],
  selectedCollection: string | undefined,
  isPro: boolean,
) {
  const localEnabled = mode === 'local';
  const filters = useMemo(() => ({ agent: agentFilter, sort: sortBy }), [agentFilter, sortBy]);
  const localPlans = usePlans(filters, localEnabled);
  const cloudPlans = useCloudPlans();
  const localAgents = useAgents(localEnabled);
  const localBackendStatus = useBackendStatus(undefined, localEnabled);
  const daemonStatus = useDaemonStatus();
  const cloudBackendStatus =
    daemonStatus === 'stale' ? 'offline' : daemonStatus === 'unknown' ? 'checking' : 'online';
  const backendStatus = mode === 'cloud' ? cloudBackendStatus : localBackendStatus;

  const allTags = useQuery(api.tags.listMyTags, isPro ? {} : 'skip');
  const allCollections = useQuery(api.collections.listMyCollections, isPro ? {} : 'skip');
  const collectionPlanIds = useQuery(
    api.collections.getPlansInCollection,
    isPro && selectedCollection ? { collectionId: selectedCollection } : 'skip',
  );

  const cloudAgents = useMemo<AgentStats[]>(() => {
    const counts = new Map<string, number>();
    for (const p of cloudPlans.plans) {
      counts.set(p.agent, (counts.get(p.agent) ?? 0) + 1);
    }
    return Array.from(counts, ([agent, planCount]) => ({ agent, planCount, writable: false }));
  }, [cloudPlans.plans]);

  const agents = mode === 'cloud' ? cloudAgents : localAgents;

  const { plans, loading, refreshing, error, refresh } =
    mode === 'cloud'
      ? {
          plans: cloudPlans.plans,
          loading: cloudPlans.loading,
          refreshing: false,
          error: cloudPlans.error,
          refresh: async () => {},
        }
      : localPlans;

  const planTagsMap = useQuery(
    api.planTags.getTagsForPlans,
    isPro && selectedTags.length > 0 && plans.length > 0
      ? { planIds: plans.map((p) => p.id) as Array<Id<'plans'>> }
      : 'skip',
  );

  const { isUnseen } = useSeenPlans();
  const hasUnseenPlans = useMemo(
    () => plans.some((p) => isUnseen(p.id, p.updatedAt)),
    [plans, isUnseen],
  );

  const collectionPlanIdSet = useMemo(
    () => (collectionPlanIds ? new Set(collectionPlanIds) : null),
    [collectionPlanIds],
  );

  const filteredPlans = useMemo(() => {
    let result = filterPlans(plans, search);
    if (mode === 'cloud' && agentFilter) {
      result = result.filter((p) => p.agent === agentFilter);
    }
    if (dateBucket !== 'all') {
      const cutoffs = { today: 86400000, '7d': 604800000, '30d': 2592000000 } as Record<
        string,
        number
      >;
      const cutoff = Date.now() - (cutoffs[dateBucket] ?? 0);
      const field = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
      result = result.filter((p) => new Date(p[field]).getTime() >= cutoff);
    }
    if (collectionPlanIdSet) {
      result = result.filter((p) => collectionPlanIdSet.has(p.id));
    }
    if (selectedTags.length > 0 && planTagsMap) {
      result = result.filter((p) => {
        const pTags = planTagsMap[p.id] ?? [];
        return selectedTags.some((tagId) => pTags.some((t: any) => t._id === tagId));
      });
    }
    if (mode === 'cloud') {
      result = [...result].sort((a, b) => {
        if (sortBy === 'title') return a.title.localeCompare(b.title);
        const field = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
        return new Date(b[field]).getTime() - new Date(a[field]).getTime();
      });
    }
    return result;
  }, [
    plans,
    search,
    mode,
    agentFilter,
    dateBucket,
    sortBy,
    collectionPlanIdSet,
    selectedTags,
    planTagsMap,
  ]);

  const prevBackendStatus = useRef(backendStatus);
  useEffect(() => {
    if (prevBackendStatus.current === 'offline' && backendStatus === 'online') {
      localPlans.refresh();
    }
    prevBackendStatus.current = backendStatus;
  }, [backendStatus, localPlans.refresh]);

  const totalPlans = useMemo(() => {
    if (mode === 'cloud') return plans.length;
    return agents.reduce((sum, a) => sum + a.planCount, 0);
  }, [agents, plans, mode]);

  const activeAgents = agents.filter((a) => a.planCount > 0).length;
  const syncing = refreshing && !loading;
  const backendIndicator = useMemo(() => {
    if (syncing) return { label: 'Syncing', color: '#f59e0b' };
    if (mode === 'cloud') {
      if (backendStatus === 'online' && plans.length === 0 && !error)
        return { label: 'Syncing', color: '#f59e0b' };
      if (backendStatus === 'online') return { label: 'Cloud', color: '#3b82f6' };
      if (backendStatus === 'checking') return { label: 'Checking', color: '#f59e0b' };
      return { label: 'Offline', color: '#ef4444' };
    }
    if (backendStatus === 'online') return { label: 'Live', color: '#22c55e' };
    if (backendStatus === 'checking') return { label: 'Checking', color: '#f59e0b' };
    return { label: 'Offline', color: '#ef4444' };
  }, [backendStatus, mode, syncing, plans.length, error]);

  return {
    agents,
    backendStatus,
    plans,
    loading,
    error,
    refresh,
    allTags,
    allCollections,
    filteredPlans,
    hasUnseenPlans,
    totalPlans,
    activeAgents,
    backendIndicator,
  };
}

function useSidebarPeek(sidebarHidden: boolean, setSidebarPeek: (v: boolean) => void) {
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    };
  }, []);

  const clear = useCallback(() => {
    if (!hoverCloseTimer.current) return;
    clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = undefined;
  }, []);

  const reveal = useCallback(() => {
    if (!sidebarHidden) return;
    clear();
    setSidebarPeek(true);
  }, [sidebarHidden, clear, setSidebarPeek]);

  const scheduleClose = useCallback(() => {
    if (!sidebarHidden) return;
    clear();
    hoverCloseTimer.current = setTimeout(() => setSidebarPeek(false), 140);
  }, [sidebarHidden, clear, setSidebarPeek]);

  return { clear, reveal, scheduleClose };
}

function DashboardTopbar({
  sidebarPinnedOpen,
  sidebarHidden,
  isPro,
  hasUnseenPlans,
  mode,
  backendStatus,
  backendIndicator,
  totalPlans,
  activeAgents,
  search,
  plans,
  selectedPlan,
  onToggleSidebar,
  onSetSearch,
  onSelectPlan,
  onNewPlan,
  onUpload,
  onToggleMode,
}: {
  sidebarPinnedOpen: boolean;
  sidebarHidden: boolean;
  isPro: boolean;
  hasUnseenPlans: boolean;
  mode: DashboardMode;
  backendStatus: string;
  backendIndicator: { label: string; color: string };
  totalPlans: number;
  activeAgents: number;
  search: string;
  plans: Plan[];
  selectedPlan: Plan | undefined;
  onToggleSidebar: () => void;
  onSetSearch: (v: string) => void;
  onSelectPlan: (p: Plan | undefined) => void;
  onNewPlan: () => void;
  onUpload: () => void;
  onToggleMode: () => void;
}) {
  return (
    <div
      className="grid items-center min-w-0 col-span-full gap-x-3 border-b border-border bg-surface z-50 box-border"
      style={{
        height: `${TOPBAR_HEIGHT}px`,
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
      }}
    >
      <div
        className="flex items-center gap-3 min-w-0 h-full overflow-hidden box-border pl-4"
        style={{
          width: sidebarPinnedOpen ? `${SIDEBAR_EXPANDED_WIDTH}px` : undefined,
          flex: sidebarPinnedOpen ? '0 0 auto' : '1 1 auto',
          paddingRight: sidebarPinnedOpen ? '12px' : undefined,
          borderRight: sidebarPinnedOpen ? '1px solid var(--border)' : 'none',
        }}
      >
        <div className="shrink-0 relative">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            className="size-[30px] rounded-lg border border-border text-text cursor-pointer flex items-center justify-center"
            style={{
              background: sidebarHidden ? 'var(--hover)' : 'transparent',
            }}
          >
            <SidebarToggleIcon hidden={sidebarHidden} />
          </button>
          {sidebarHidden && isPro && hasUnseenPlans && (
            <span className="sidebar-dot absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500 pointer-events-none" />
          )}
        </div>
        <span className="font-semibold text-sm tracking-tight text-text whitespace-nowrap">
          Agendex
        </span>
        {mode === 'local' && backendStatus === 'online' && (
          <>
            <button
              type="button"
              onClick={onNewPlan}
              aria-label="Create new plan"
              title="Create new plan"
              className="ml-2 size-7 rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer flex items-center justify-center"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                className="size-[15px]"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={onUpload}
              aria-label="Upload plan"
              title="Upload plan"
              className="size-7 rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer flex items-center justify-center"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                className="size-[15px]"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      <div className="hidden md:flex min-w-0 justify-center">
        <SearchBar
          search={search}
          onSearch={onSetSearch}
          plans={plans}
          selectedId={selectedPlan?.id}
          onSelectPlan={onSelectPlan}
          isPro={isPro}
        />
      </div>

      <div className="flex items-center justify-end gap-3 min-w-0 justify-self-end pr-4">
        <ThemeToggle />
        <SubscriptionBadge />
        <AuthButton />
        <div className="hidden lg:block w-px h-[18px] bg-border" />
        {mode === 'cloud' && totalPlans === 0 ? (
          <span className="hidden lg:inline text-xs text-tertiary">Syncing...</span>
        ) : (
          <>
            <span className="hidden lg:inline text-xs text-tertiary">
              <strong className="text-secondary" style={{ fontWeight: 550 }}>
                {totalPlans}
              </strong>{' '}
              plans
            </span>
            <div className="hidden lg:block w-px h-[18px] bg-border" />
            <span className="hidden lg:inline text-xs text-tertiary">
              <strong className="text-secondary" style={{ fontWeight: 550 }}>
                {activeAgents}
              </strong>{' '}
              agents
            </span>
          </>
        )}
        <div className="hidden lg:block w-px h-[18px] bg-border" />
        <div className="hidden lg:flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleMode}
            className="text-[11px] py-0.5 px-2 rounded border border-border bg-transparent text-secondary cursor-pointer uppercase tracking-wide"
            style={{ fontWeight: 550 }}
          >
            {mode}
          </button>
        </div>
        <div className="hidden lg:block w-px h-[18px] bg-border" />
        <div className="hidden lg:flex items-center gap-1.5">
          <div
            className="rounded-full status-pulse size-1.5 shadow-[0_0_0_2px_var(--surface)]"
            style={{ background: backendIndicator.color }}
          />
          <span className="text-xs text-tertiary">{backendIndicator.label}</span>
        </div>
      </div>
    </div>
  );
}

function DashboardMain({
  mode,
  isPro,
  backendStatus,
  uploading,
  creating,
  editing,
  showHistory,
  sharing,
  agents,
  totalPlans,
  selectedPlan,
  onClose,
  onSaved,
  onCreated,
  onEdit,
  onHistory,
  onShare,
  onCloseShare,
  onChartWideChange,
  onSwitchLocal,
  onSearch,
  onRescan,
}: {
  mode: DashboardMode;
  isPro: boolean;
  backendStatus: string;
  uploading: boolean;
  creating: boolean;
  editing: boolean;
  showHistory: boolean;
  sharing: boolean;
  agents: AgentStats[];
  totalPlans: number;
  selectedPlan: Plan | undefined;
  onClose: () => void;
  onSaved: () => void;
  onCreated: (plan: Plan) => void;
  onEdit: () => void;
  onHistory: () => void;
  onShare: () => void;
  onCloseShare: () => void;
  onChartWideChange: (wide: boolean) => void;
  onSwitchLocal: () => void;
  onSearch: () => void;
  onRescan: () => Promise<void>;
}) {
  return (
    <div
      className="overflow-auto main-scroll col-start-2 row-start-2 bg-bg"
      style={{ viewTransitionName: 'main-content' }}
    >
      {mode === 'cloud' && !isPro ? (
        <CloudUpgrade onSwitchLocal={onSwitchLocal} />
      ) : mode === 'local' && backendStatus === 'offline' ? (
        <OfflineView />
      ) : uploading ? (
        <Suspense
          fallback={
            <div className="p-4">
              <SkeletonBlock lines={5} />
            </div>
          }
        >
          <PlanUploader agents={agents} onClose={onClose} onCreated={onCreated} />
        </Suspense>
      ) : creating ? (
        <Suspense
          fallback={
            <div className="p-4">
              <SkeletonBlock lines={5} />
            </div>
          }
        >
          <PaywallGuard onBack={onClose}>
            <PlanCreator agents={agents} onClose={onClose} onCreated={onCreated} />
          </PaywallGuard>
        </Suspense>
      ) : selectedPlan ? (
        editing ? (
          <Suspense
            fallback={
              <div className="p-4">
                <SkeletonBlock lines={5} />
              </div>
            }
          >
            <PlanEditor plan={selectedPlan} onClose={onClose} onSaved={onSaved} />
          </Suspense>
        ) : showHistory ? (
          <Suspense
            fallback={
              <div className="p-4">
                <SkeletonBlock lines={5} />
              </div>
            }
          >
            <PlanHistoryDrawer planId={selectedPlan.id} onClose={onClose} />
          </Suspense>
        ) : (
          <>
            <PlanViewer
              plan={selectedPlan}
              onEdit={onEdit}
              onChartWideChange={onChartWideChange}
              onHistory={isPro ? onHistory : undefined}
              onShare={isPro ? onShare : undefined}
              headerExtra={isPro ? <PlanTagsBar planId={selectedPlan.id} /> : undefined}
            />
            {sharing && isPro && <SharePlanDialog plan={selectedPlan} onClose={onCloseShare} />}
          </>
        )
      ) : mode === 'cloud' ? (
        <CloudEmptyState planCount={totalPlans} />
      ) : (
        <EmptyStateView
          onSearch={onSearch}
          onRescan={onRescan}
          planCount={totalPlans}
          agents={agents}
        />
      )}
    </div>
  );
}

function DashboardSidebar({
  sidebarHidden,
  sidebarVisible,
  sidebarPeekOpen,
  mode,
  backendStatus,
  isPro,
  loading,
  error,
  sortBy,
  dateBucket,
  agents,
  agentFilter,
  allTags,
  selectedTags,
  allCollections,
  selectedCollection,
  filteredPlans,
  selectedPlan,
  onRevealHover,
  onScheduleClose,
  onSortChange,
  onDateBucketChange,
  onAgentSelect,
  onTagSelect,
  onCollectionSelect,
  onSelectPlan,
  onNewPlan,
  onUpload,
}: {
  sidebarHidden: boolean;
  sidebarVisible: boolean;
  sidebarPeekOpen: boolean;
  mode: DashboardMode;
  backendStatus: string;
  isPro: boolean;
  loading: boolean;
  error: string | null | undefined;
  sortBy: 'updatedAt' | 'createdAt' | 'title';
  dateBucket: 'all' | 'today' | '7d' | '30d';
  agents: AgentStats[];
  agentFilter: string | undefined;
  allTags: any[] | undefined;
  selectedTags: string[];
  allCollections: any[] | undefined;
  selectedCollection: string | undefined;
  filteredPlans: Plan[];
  selectedPlan: Plan | undefined;
  onRevealHover: () => void;
  onScheduleClose: () => void;
  onSortChange: (v: 'updatedAt' | 'createdAt' | 'title') => void;
  onDateBucketChange: (v: 'all' | 'today' | '7d' | '30d') => void;
  onAgentSelect: (v: string | undefined) => void;
  onTagSelect: (v: string[]) => void;
  onCollectionSelect: (v: string | undefined) => void;
  onSelectPlan: (plan: Plan) => void;
  onNewPlan: () => void;
  onUpload: () => void;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden col-start-1 row-start-2 bg-surface min-w-0 origin-top-left"
      onMouseEnter={onRevealHover}
      onMouseLeave={onScheduleClose}
      style={{
        position: sidebarHidden ? 'absolute' : 'relative',
        top: sidebarHidden ? 0 : undefined,
        left: sidebarHidden ? 0 : undefined,
        height: sidebarHidden ? '100%' : undefined,
        width: `${SIDEBAR_EXPANDED_WIDTH}px`,
        zIndex: sidebarHidden ? 45 : undefined,
        borderRight: sidebarVisible ? '1px solid var(--border)' : 'none',
        opacity: sidebarHidden ? (sidebarPeekOpen ? 1 : 0) : 1,
        transform: sidebarHidden
          ? sidebarPeekOpen
            ? 'scale(1) translateY(0)'
            : 'scale(0.96) translateY(8px)'
          : 'none',
        pointerEvents: sidebarVisible ? 'auto' : 'none',
        boxShadow: sidebarPeekOpen ? '0 18px 40px rgba(0,0,0,0.20)' : 'none',
        transition: sidebarHidden
          ? 'transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease'
          : 'opacity 120ms ease',
      }}
    >
      <div className="px-3 pt-3 pb-2">
        {mode === 'local' && backendStatus === 'online' && (
          <div className="flex gap-1.5 mb-2">
            <button
              type="button"
              onClick={onNewPlan}
              className="flex-1 py-1.5 px-2.5 text-[12.5px] font-inherit rounded-[7px] border border-border bg-transparent text-text cursor-pointer flex items-center justify-center gap-[5px]"
              style={{ fontWeight: 550 }}
            >
              <span className="text-[15px] leading-none">+</span> New
            </button>
            <button
              type="button"
              onClick={onUpload}
              aria-label="Upload plan"
              title="Upload plan"
              className="py-1.5 px-2.5 text-[12.5px] font-inherit rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer flex items-center justify-center"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="size-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13"
                />
              </svg>
            </button>
          </div>
        )}
        <SidebarFilters
          sortBy={sortBy}
          onSortChange={onSortChange}
          dateBucket={dateBucket}
          onDateBucketChange={onDateBucketChange}
          agents={agents}
          selectedAgent={agentFilter}
          onAgentSelect={onAgentSelect}
          tags={allTags}
          selectedTags={selectedTags}
          onTagSelect={onTagSelect}
          collections={allCollections}
          selectedCollection={selectedCollection}
          onCollectionSelect={onCollectionSelect}
        />
      </div>

      <div className="flex-1 overflow-auto sidebar-scroll px-3 pb-3">
        {loading ? (
          <div className="p-4">
            <SkeletonBlock lines={5} />
          </div>
        ) : error ? (
          <div className="p-4 text-[13px] text-red-500">Failed to load plans.</div>
        ) : mode === 'cloud' && filteredPlans.length === 0 ? (
          <div className="p-4 text-[12.5px] text-tertiary text-center">Syncing plans...</div>
        ) : (
          <PlanList
            plans={filteredPlans}
            selectedId={selectedPlan?.id}
            onSelect={onSelectPlan}
            isPro={isPro}
          />
        )}
      </div>
    </div>
  );
}

type Panel = 'editing' | 'creating' | 'uploading' | 'history' | 'sharing' | null;

type DashState = {
  selectedTags: string[];
  selectedCollection: string | undefined;
  activePanel: Panel;
  showPricingModal: boolean;
  mode: DashboardMode;
  sidebarHidden: boolean;
  sidebarPeek: boolean;
};

type DashAction =
  | { type: 'SET_TAGS'; value: string[] }
  | { type: 'SET_COLLECTION'; value: string | undefined }
  | { type: 'SET_PANEL'; value: Panel }
  | { type: 'SET_PRICING_MODAL'; value: boolean }
  | { type: 'SET_MODE'; value: DashboardMode }
  | { type: 'SET_SIDEBAR_HIDDEN'; value: boolean }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_PEEK'; value: boolean };

function dashReducer(s: DashState, a: DashAction): DashState {
  switch (a.type) {
    case 'SET_TAGS':
      return { ...s, selectedTags: a.value };
    case 'SET_COLLECTION':
      return { ...s, selectedCollection: a.value };
    case 'SET_PANEL':
      return { ...s, activePanel: a.value };
    case 'SET_PRICING_MODAL':
      return { ...s, showPricingModal: a.value };
    case 'SET_MODE':
      return { ...s, mode: a.value };
    case 'SET_SIDEBAR_HIDDEN':
      return { ...s, sidebarHidden: a.value, sidebarPeek: false };
    case 'TOGGLE_SIDEBAR':
      return { ...s, sidebarHidden: !s.sidebarHidden, sidebarPeek: false };
    case 'SET_SIDEBAR_PEEK':
      return { ...s, sidebarPeek: a.value };
  }
}

function Dashboard() {
  const [search, setSearch] = useQueryState(
    'q',
    parseAsString
      .withDefault('')
      .withOptions({ clearOnDefault: true, limitUrlUpdates: throttle(500) }),
  );
  const [{ agent: agentFilterRaw, sort: sortBy, date: dateBucket }, setFilters] = useQueryStates(
    {
      agent: parseAsString,
      sort: parseAsStringLiteral(sortOptions).withDefault('updatedAt'),
      date: parseAsStringLiteral(dateOptions).withDefault('all'),
    },
    { clearOnDefault: true },
  );
  const [selectedPlanId, setSelectedPlanId] = useQueryState(
    'plan',
    parseAsString.withOptions({ history: 'push', clearOnDefault: true }),
  );

  const agentFilter = agentFilterRaw ?? undefined;
  const setAgentFilter = useCallback(
    (agent: string | undefined) => setFilters({ agent: agent ?? null }),
    [setFilters],
  );
  const setSortBy = useCallback(
    (sort: 'updatedAt' | 'createdAt' | 'title') => setFilters({ sort }),
    [setFilters],
  );
  const setDateBucket = useCallback(
    (date: 'all' | 'today' | '7d' | '30d') => setFilters({ date }),
    [setFilters],
  );

  const { isAuthenticated } = useAuth();
  const defaultMode: DashboardMode = isAuthenticated ? 'cloud' : 'local';

  const [ds, dsd] = useReducer(dashReducer, {
    selectedTags: [],
    selectedCollection: undefined,
    activePanel: null,
    showPricingModal: false,
    mode: defaultMode,
    sidebarHidden: localStorage.getItem(SIDEBAR_PREF_KEY) === 'true',
    sidebarPeek: false,
  });

  const {
    selectedTags,
    selectedCollection,
    activePanel,
    showPricingModal,
    mode,
    sidebarHidden,
    sidebarPeek,
  } = ds;
  const setSelectedTags = (v: string[]) => dsd({ type: 'SET_TAGS', value: v });
  const setSelectedCollection = (v: string | undefined) =>
    dsd({ type: 'SET_COLLECTION', value: v });
  const setActivePanel = (v: Panel) => dsd({ type: 'SET_PANEL', value: v });
  const setShowPricingModal = (v: boolean) => dsd({ type: 'SET_PRICING_MODAL', value: v });
  const setMode = (v: DashboardMode) => dsd({ type: 'SET_MODE', value: v });
  const setSidebarHidden = (v: boolean) => dsd({ type: 'SET_SIDEBAR_HIDDEN', value: v });
  const setSidebarPeek = (v: boolean) => dsd({ type: 'SET_SIDEBAR_PEEK', value: v });

  const editing = activePanel === 'editing';
  const creating = activePanel === 'creating';
  const uploading = activePanel === 'uploading';
  const showHistory = activePanel === 'history';
  const sharing = activePanel === 'sharing';
  const sidebarBeforeWide = useRef<boolean | null>(null);
  const { isActive: isPro } = useSubscription();

  const {
    agents,
    backendStatus,
    plans,
    loading,
    error,
    refresh,
    allTags,
    allCollections,
    filteredPlans,
    hasUnseenPlans,
    totalPlans,
    activeAgents,
    backendIndicator,
  } = useDashboardData(
    mode,
    agentFilter,
    sortBy,
    dateBucket,
    search,
    selectedTags,
    selectedCollection,
    isPro,
  );

  const sidebarPinnedOpen = !sidebarHidden;
  const sidebarPeekOpen = sidebarHidden && sidebarPeek;
  const sidebarVisible = sidebarPinnedOpen || sidebarPeekOpen;
  const sidebarWidth = sidebarPinnedOpen ? SIDEBAR_EXPANDED_WIDTH : 0;

  const peek = useSidebarPeek(sidebarHidden, setSidebarPeek);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_PREF_KEY, sidebarHidden ? 'true' : 'false');
  }, [sidebarHidden]);

  const selectedPlan = useMemo(() => {
    if (filteredPlans.length === 0) return undefined;
    if (selectedPlanId) {
      return (
        filteredPlans.find((p) => p.id === selectedPlanId) ??
        (mode === 'local' ? filteredPlans[0] : undefined)
      );
    }
    return mode === 'local' ? filteredPlans[0] : undefined;
  }, [filteredPlans, selectedPlanId, mode]);

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => setSelectedPlanId(plan?.id ?? null),
    [setSelectedPlanId],
  );

  useEffect(() => {
    if (filteredPlans.length === 0 && selectedPlanId) {
      setSelectedPlanId(null);
      setActivePanel(null);
    }
  }, [filteredPlans, selectedPlanId, setSelectedPlanId]);

  function handleSaved() {
    setActivePanel(null);
    refresh();
  }

  function toggleSidebar() {
    peek.clear();
    dsd({ type: 'TOGGLE_SIDEBAR' });
  }

  function handleNewPlan() {
    if (isPro) {
      startViewTransition(() => setActivePanel('creating'));
    } else {
      setShowPricingModal(true);
    }
  }

  function handleUpload() {
    startViewTransition(() => setActivePanel('uploading'));
  }

  function handleChartWideChange(wide: boolean) {
    if (wide) {
      sidebarBeforeWide.current = !sidebarHidden;
      if (!sidebarHidden) setSidebarHidden(true);
    } else {
      if (sidebarBeforeWide.current) setSidebarHidden(false);
      sidebarBeforeWide.current = null;
    }
  }

  return (
    <div
      className="h-screen grid overflow-clip relative transition-[grid-template-columns] duration-[180ms] ease-in-out"
      style={{
        gridTemplateColumns: `${sidebarWidth}px 1fr`,
        gridTemplateRows: `${TOPBAR_HEIGHT}px 1fr`,
      }}
    >
      <DashboardTopbar
        sidebarPinnedOpen={sidebarPinnedOpen}
        sidebarHidden={sidebarHidden}
        isPro={isPro}
        hasUnseenPlans={hasUnseenPlans}
        mode={mode}
        backendStatus={backendStatus}
        backendIndicator={backendIndicator}
        totalPlans={totalPlans}
        activeAgents={activeAgents}
        search={search}
        plans={plans}
        selectedPlan={selectedPlan}
        onToggleSidebar={toggleSidebar}
        onSetSearch={setSearch}
        onSelectPlan={setSelectedPlan}
        onNewPlan={handleNewPlan}
        onUpload={handleUpload}
        onToggleMode={() => setMode(mode === 'local' ? 'cloud' : 'local')}
      />

      {sidebarHidden && (
        <div
          className="absolute left-0 z-40"
          onMouseEnter={peek.reveal}
          onMouseLeave={peek.scheduleClose}
          style={{
            top: `${TOPBAR_HEIGHT}px`,
            height: `calc(100% - ${TOPBAR_HEIGHT}px)`,
            width: `${SIDEBAR_HOVER_ZONE_WIDTH}px`,
          }}
          aria-hidden="true"
        />
      )}

      <DashboardSidebar
        sidebarHidden={sidebarHidden}
        sidebarVisible={sidebarVisible}
        sidebarPeekOpen={sidebarPeekOpen}
        mode={mode}
        backendStatus={backendStatus}
        isPro={isPro}
        loading={loading}
        error={error}
        sortBy={sortBy}
        dateBucket={dateBucket}
        agents={agents}
        agentFilter={agentFilter}
        allTags={allTags ?? undefined}
        selectedTags={selectedTags}
        allCollections={allCollections ?? undefined}
        selectedCollection={selectedCollection}
        filteredPlans={filteredPlans}
        selectedPlan={selectedPlan}
        onRevealHover={peek.reveal}
        onScheduleClose={peek.scheduleClose}
        onSortChange={setSortBy}
        onDateBucketChange={setDateBucket}
        onAgentSelect={setAgentFilter}
        onTagSelect={setSelectedTags}
        onCollectionSelect={setSelectedCollection}
        onSelectPlan={(plan) => startViewTransition(() => setSelectedPlan(plan))}
        onNewPlan={handleNewPlan}
        onUpload={handleUpload}
      />

      <DashboardMain
        mode={mode}
        isPro={isPro}
        backendStatus={backendStatus}
        uploading={uploading}
        creating={creating}
        editing={editing}
        showHistory={showHistory}
        sharing={sharing}
        agents={agents}
        totalPlans={totalPlans}
        selectedPlan={selectedPlan}
        onClose={() => startViewTransition(() => setActivePanel(null))}
        onSaved={handleSaved}
        onCreated={(plan) => {
          startViewTransition(() => {
            setActivePanel(null);
            refresh();
            setSelectedPlan(plan);
          });
        }}
        onEdit={() => startViewTransition(() => setActivePanel('editing'))}
        onHistory={() => startViewTransition(() => setActivePanel('history'))}
        onShare={() => setActivePanel('sharing')}
        onCloseShare={() => setActivePanel(null)}
        onChartWideChange={handleChartWideChange}
        onSwitchLocal={() => setMode('local')}
        onSearch={() => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          );
        }}
        onRescan={async () => {
          await refresh();
        }}
      />

      {showPricingModal && <PricingModal onClose={() => setShowPricingModal(false)} />}
    </div>
  );
}

function CliAuthRoute() {
  const callback = new URLSearchParams(window.location.search).get('callback');
  if (!callback) return <Redirect to="/" />;
  return <CliAuthPage callbackUrl={callback} />;
}

function HomeRoute() {
  const { isAuthenticated, isLoading, signIn } = useAuth();
  const { needsOnboarding, onboardingLoading } = useSubscription();

  if (hasToken()) return <Dashboard />;

  if (!isAuthenticated) {
    if (isLoading) return null;
    return (
      <LandingPage onCloudLogin={() => signIn.social({ provider: 'github', callbackURL: '/' })} />
    );
  }

  if (onboardingLoading) return null;
  if (needsOnboarding) return <Redirect to="/welcome" />;

  return <Dashboard />;
}

export default function App() {
  return (
    <Switch>
      <Route path="/auth/cli" component={CliAuthRoute} />
      <Route path="/shared/:token">{({ token }) => <SharedPlanView token={token} />}</Route>
      <Route path="/welcome">
        <OnboardingRoute>
          <WelcomeScreen />
        </OnboardingRoute>
      </Route>
      <Route path="/" component={HomeRoute} />
    </Switch>
  );
}
