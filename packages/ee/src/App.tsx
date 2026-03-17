import {
  type AgentStats,
  EmptyStateView,
  filterPlans,
  hasToken,
  LandingPage,
  OfflineView,
  type Plan,
  PlanList,
  PlanViewer,
  SidebarFilters,
  SkeletonBlock,
  startViewTransition,
  useAgents,
  useBackendStatus,
  usePlans,
  useSeenPlans,
} from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { parseAsString, parseAsStringLiteral, throttle, useQueryState, useQueryStates } from 'nuqs';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { CliAuthPage } from './components/CliAuthPage.tsx';
import { CloudPlanCreator } from './components/CloudPlanCreator.tsx';
import { CloudPlanEditor } from './components/CloudPlanEditor.tsx';
import { CloudPlanUploader } from './components/CloudPlanUploader.tsx';
import { CloudUpgrade } from './components/CloudUpgrade.tsx';
import { CommentThread } from './components/CommentThread.tsx';
import { DashboardTopbar } from './components/DashboardTopbar.tsx';
import { OnboardingRoute } from './components/OnboardingRoute.tsx';
import { PaywallGuard } from './components/PaywallGuard.tsx';
import { PlanTagsBar } from './components/PlanTagsBar.tsx';
import { PricingModal } from './components/PricingModal.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';
import { SharedPlanView } from './components/SharedPlanView.tsx';
import { SharePlanDialog } from './components/SharePlanDialog.tsx';
import { WelcomeScreen } from './components/WelcomeScreen.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { useCloudPlans } from './hooks/useCloudPlans.ts';
import { useDaemonStatus } from './hooks/useDaemonStatus.ts';
import { useSubscription } from './hooks/useSubscription.ts';
import { useSyncIndicator } from './hooks/useSyncIndicator.ts';

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

const sortOptions = ['updatedAt', 'createdAt', 'title'] as const;
const dateOptions = ['all', 'today', '7d', '30d'] as const;

type TagRecord = Doc<'tags'>;
type CollectionRecord = Doc<'collections'>;

function BootLoadingView({
  message = 'Loading your dashboard...',
  fullscreen = true,
}: {
  message?: string;
  fullscreen?: boolean;
}) {
  return (
    <div
      className={
        fullscreen
          ? 'h-screen flex items-center justify-center bg-bg'
          : 'h-full min-h-[280px] flex items-center justify-center'
      }
    >
      <div className="w-full max-w-[420px] px-5">
        <div className="text-[13px] text-tertiary mb-3 text-center">{message}</div>
        <SkeletonBlock lines={4} />
      </div>
    </div>
  );
}

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
    isPro && selectedCollection
      ? { collectionId: selectedCollection as Id<'collections'> }
      : 'skip',
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
      result = result.filter((p) => collectionPlanIdSet.has(p.id as Id<'plans'>));
    }
    if (selectedTags.length > 0 && planTagsMap) {
      result = result.filter((p) => {
        const pTags = planTagsMap[p.id] ?? [];
        return selectedTags.some((tagId) => pTags.some((tag: TagRecord) => tag._id === tagId));
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
  const syncIndicator = useSyncIndicator(plans, loading);
  const syncing = syncIndicator || (refreshing && !loading);
  const backendIndicator = useMemo(() => {
    if (syncing) return { label: 'Syncing', color: '#f59e0b' };
    if (mode === 'cloud') {
      if (backendStatus === 'online' && plans.length === 0 && !error)
        return { label: 'Syncing', color: '#f59e0b' };
      if (backendStatus === 'online') return { label: 'Cloud', color: '#22c55e' };
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
      ) : mode === 'cloud' && backendStatus === 'checking' ? (
        <BootLoadingView message="Connecting to cloud..." fullscreen={false} />
      ) : backendStatus === 'offline' ? (
        <OfflineView />
      ) : uploading ? (
        <Suspense
          fallback={
            <div className="p-4">
              <SkeletonBlock lines={5} />
            </div>
          }
        >
          {mode === 'cloud' ? (
            <CloudPlanUploader agents={agents} onClose={onClose} onCreated={onCreated} />
          ) : (
            <PlanUploader agents={agents} onClose={onClose} onCreated={onCreated} />
          )}
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
            {mode === 'cloud' ? (
              <CloudPlanCreator agents={agents} onClose={onClose} onCreated={onCreated} />
            ) : (
              <PlanCreator agents={agents} onClose={onClose} onCreated={onCreated} />
            )}
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
            {mode === 'cloud' ? (
              <CloudPlanEditor plan={selectedPlan} onClose={onClose} onSaved={onSaved} />
            ) : (
              <PlanEditor plan={selectedPlan} onClose={onClose} onSaved={onSaved} />
            )}
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
            {isPro && mode === 'cloud' && (
              <div className="max-w-[720px] mx-auto px-8 pb-16">
                <CommentThread planId={selectedPlan.id} isOwner />
              </div>
            )}
            {sharing && isPro && (
              <SharePlanDialog plan={selectedPlan} mode={mode} onClose={onCloseShare} />
            )}
          </>
        )
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
  allTags: TagRecord[] | undefined;
  selectedTags: string[];
  allCollections: CollectionRecord[] | undefined;
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
      <div
        className="px-3 pt-3 pb-2"
        style={
          backendStatus === 'offline'
            ? {
                opacity: 0.35,
                filter: 'blur(1.5px)',
                pointerEvents: 'none',
                transition: 'opacity 0.3s, filter 0.3s',
              }
            : { transition: 'opacity 0.3s, filter 0.3s' }
        }
      >
        {(mode === 'local' || (mode === 'cloud' && isPro)) && (
          <div className="flex gap-1.5 mb-2">
            <button
              type="button"
              onClick={onNewPlan}
              className="sidebar-new-btn flex-1 h-8 px-3 text-[12px] font-semibold tracking-[-0.01em] rounded-lg cursor-pointer flex items-center justify-center gap-1.5 border-none transition-all duration-150"
              style={{
                background: '#c8ff32',
                color: '#111',
                boxShadow: '0 0 0 1px rgba(200,255,50,0.15), 0 1px 3px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#d4ff5c';
                e.currentTarget.style.boxShadow =
                  '0 0 0 1px rgba(200,255,50,0.3), 0 2px 8px rgba(200,255,50,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#c8ff32';
                e.currentTarget.style.boxShadow =
                  '0 0 0 1px rgba(200,255,50,0.15), 0 1px 3px rgba(0,0,0,0.3)';
              }}
            >
              <svg
                aria-hidden="true"
                width="11"
                height="11"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 1v10M1 6h10" />
              </svg>
              New plan
            </button>
            <button
              type="button"
              onClick={onUpload}
              aria-label="Upload plan"
              title="Upload plan"
              className="h-8 w-8 shrink-0 rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center transition-all duration-150 hover:text-secondary hover:border-[rgba(255,255,255,0.12)] hover:bg-hover"
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

      <div
        className="flex-1 overflow-auto sidebar-scroll px-3 pb-3"
        style={
          backendStatus === 'offline'
            ? {
                opacity: 0.35,
                filter: 'blur(1.5px)',
                pointerEvents: 'none',
                transition: 'opacity 0.3s, filter 0.3s',
              }
            : { transition: 'opacity 0.3s, filter 0.3s' }
        }
      >
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

function Dashboard({ autoMode }: { autoMode: DashboardMode }) {
  const [, navigate] = useLocation();
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

  const [ds, dsd] = useReducer(dashReducer, {
    selectedTags: [],
    selectedCollection: undefined,
    activePanel: null,
    showPricingModal: false,
    mode: autoMode,
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
  const setActivePanel = useCallback((v: Panel) => dsd({ type: 'SET_PANEL', value: v }), []);
  const setShowPricingModal = (v: boolean) => dsd({ type: 'SET_PRICING_MODAL', value: v });
  const setMode = useCallback((v: DashboardMode) => dsd({ type: 'SET_MODE', value: v }), []);
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
  const [optimisticSelectedPlan, setOptimisticSelectedPlan] = useState<Plan | undefined>(undefined);
  const previousAutoMode = useRef(autoMode);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_PREF_KEY, sidebarHidden ? 'true' : 'false');
  }, [sidebarHidden]);

  useEffect(() => {
    if (previousAutoMode.current === autoMode) return;
    previousAutoMode.current = autoMode;
    setMode(autoMode);
  }, [autoMode, setMode]);

  const selectedPlan = useMemo(() => {
    if (selectedPlanId) {
      return (
        filteredPlans.find((p) => p.id === selectedPlanId) ??
        plans.find((p) => p.id === selectedPlanId) ??
        (optimisticSelectedPlan?.id === selectedPlanId ? optimisticSelectedPlan : undefined) ??
        (mode === 'local' ? filteredPlans[0] : undefined)
      );
    }
    return mode === 'local' ? filteredPlans[0] : undefined;
  }, [filteredPlans, plans, optimisticSelectedPlan, selectedPlanId, mode]);

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => {
      setOptimisticSelectedPlan(plan);
      setSelectedPlanId(plan?.id ?? null);
    },
    [setSelectedPlanId],
  );

  useEffect(() => {
    if (!selectedPlanId) {
      setOptimisticSelectedPlan(undefined);
      return;
    }
    if (plans.some((plan) => plan.id === selectedPlanId)) {
      setOptimisticSelectedPlan((current) =>
        current?.id === selectedPlanId ? undefined : current,
      );
    }
  }, [plans, selectedPlanId]);

  useEffect(() => {
    if (!selectedPlanId || loading) return;
    const hasSelectedPlan = plans.some((plan) => plan.id === selectedPlanId);
    const hasOptimisticPlan = optimisticSelectedPlan?.id === selectedPlanId;
    if (!hasSelectedPlan && !hasOptimisticPlan) {
      setSelectedPlanId(null);
      if (filteredPlans.length === 0) {
        setActivePanel(null);
      }
    }
  }, [
    filteredPlans.length,
    loading,
    optimisticSelectedPlan,
    plans,
    selectedPlanId,
    setActivePanel,
    setSelectedPlanId,
  ]);

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
        height={TOPBAR_HEIGHT}
        onToggleSidebar={toggleSidebar}
        onSetSearch={setSearch}
        onSelectPlan={setSelectedPlan}
        onNewPlan={handleNewPlan}
        onUpload={handleUpload}
        onToggleMode={() => setMode(mode === 'local' ? 'cloud' : 'local')}
        onHistory={() => startViewTransition(() => setActivePanel('history'))}
        onNavigate={(path: string) => startViewTransition(() => navigate(path))}
        onShowPricing={() => setShowPricingModal(true)}
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
  const hasCachedToken = hasToken();
  const { needsOnboarding, onboardingResolved } = useSubscription({
    enabled: !isLoading && isAuthenticated,
  });

  if (isAuthenticated && onboardingResolved && needsOnboarding) return <Redirect to="/welcome" />;

  if (hasCachedToken) {
    return <Dashboard autoMode={isAuthenticated && onboardingResolved ? 'cloud' : 'local'} />;
  }

  if (isAuthenticated) {
    if (!onboardingResolved) return <BootLoadingView />;
    return <Dashboard autoMode="cloud" />;
  }

  return <LandingPage onCloudLogin={(provider) => signIn.social({ provider, callbackURL: '/' })} />;
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
      <Route path="/settings" component={SettingsPage} />
      <Route path="/" component={HomeRoute} />
    </Switch>
  );
}
