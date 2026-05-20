import {
  AgentAvatarProvider,
  type AgentStats,
  ChangelogPage,
  EmptyStateView,
  filterPlans,
  hasToken,
  LandingPage,
  MAX_FOLDERS,
  OfflineView,
  type Plan,
  PlanList,
  PlanSourcesDialog,
  type PlanState,
  PlanViewer,
  SidebarFilters,
  SidebarResizeHandle,
  SkeletonBlock,
  startViewTransition,
  useAgents,
  useBackendStatus,
  usePlanFolders,
  usePlanState,
  usePlans,
  useSidebarWidth,
} from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useMutation, useQuery } from 'convex/react';
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
import { CHART_PREF_STORAGE_KEY } from './chartPref.ts';
import { AboutMePage } from './components/AboutMePage.tsx';
import { AcceptInvitePage } from './components/AcceptInvitePage.tsx';
import { AuthPage } from './components/AuthPage.tsx';
import { CliAuthPage } from './components/CliAuthPage.tsx';
import { CloudPlanCreator } from './components/CloudPlanCreator.tsx';
import { CloudPlanEditor } from './components/CloudPlanEditor.tsx';
import {
  CloudPlannotatorBadge,
  CloudPlannotatorWritebackPanel,
} from './components/CloudPlannotatorPanel.tsx';
import { CloudPlanUploader } from './components/CloudPlanUploader.tsx';
import { CloudUpgrade } from './components/CloudUpgrade.tsx';
import { CommentThread } from './components/CommentThread.tsx';
import { DashboardTopbar } from './components/DashboardTopbar.tsx';
import { EEHeroCta, EENavbarAuth, EEPricingCta } from './components/LandingAuthSlots.tsx';
import { LocalIpDisclosureNotice } from './components/LocalIpDisclosureNotice.tsx';
import { OnboardingRoute } from './components/OnboardingRoute.tsx';
import { PaywallGuard } from './components/PaywallGuard.tsx';
import { PlanTagsBar } from './components/PlanTagsBar.tsx';
import { PricingModal } from './components/PricingModal.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';
import { SharedPlanView } from './components/SharedPlanView.tsx';
import { SharePlanDialog } from './components/SharePlanDialog.tsx';
import { WelcomeScreen } from './components/WelcomeScreen.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { useCloudPlanPreferences } from './hooks/useCloudPlanPreferences.ts';
import { useCloudPlans } from './hooks/useCloudPlans.ts';
import { useDaemonStatus } from './hooks/useDaemonStatus.ts';
import { useSubscription } from './hooks/useSubscription.ts';
import { useSyncIndicator } from './hooks/useSyncIndicator.ts';
import { useWorkspaceAccess } from './hooks/useWorkspaceAccess.ts';
import { APP_URL, normalizeLocalDevUrl } from './lib/auth-client.ts';
import { OUTLINE_PREF_STORAGE_KEY } from './outlinePref.ts';

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

const AUTH_SESSION_SETTLE_DELAY_MS = 250;

function getNormalizedOrigin(url: string | undefined): string | undefined {
  try {
    const normalized = normalizeLocalDevUrl(url);
    return normalized ? new URL(normalized).origin : undefined;
  } catch {
    return undefined;
  }
}

function isOriginTrustedByUrl(origin: string, url: string | undefined): boolean {
  return origin === getNormalizedOrigin(url);
}

function getApexHost(url: string | undefined): string | undefined {
  try {
    const normalized = normalizeLocalDevUrl(url);
    return normalized ? new URL(normalized).hostname.replace(/^www\./, '') : undefined;
  } catch {
    return undefined;
  }
}

function useAuthSessionSettled({
  isAuthenticated,
  isLoading,
  refreshSession,
  hold = false,
  skip = false,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
  hold?: boolean;
  skip?: boolean;
}) {
  const [settled, setSettled] = useState(false);
  const didVerifyUnauthRef = useRef(false);
  const refreshSessionRef = useRef(refreshSession);
  refreshSessionRef.current = refreshSession;

  useEffect(() => {
    if (skip) {
      didVerifyUnauthRef.current = false;
      setSettled(true);
      return;
    }

    if (isAuthenticated) {
      didVerifyUnauthRef.current = false;
      setSettled(true);
      return;
    }

    if (hold || isLoading) {
      setSettled(false);
      return;
    }

    if (didVerifyUnauthRef.current) {
      setSettled(true);
      return;
    }

    let cancelled = false;
    setSettled(false);

    const timeoutId = setTimeout(() => {
      async function verifySession() {
        try {
          await refreshSessionRef.current();
        } catch {
          // Treat errors as settled so signed-out marketing users are not blocked forever.
        } finally {
          didVerifyUnauthRef.current = true;
          if (!cancelled) setSettled(true);
        }
      }

      void verifySession();
    }, AUTH_SESSION_SETTLE_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [hold, isAuthenticated, isLoading, skip]);

  return settled;
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
  localPlanState: PlanState,
  cloudPlanState: PlanState,
) {
  const localEnabled = mode === 'local';
  const filters = useMemo(() => ({ agent: agentFilter, sort: sortBy }), [agentFilter, sortBy]);
  const localPlans = usePlans(filters, localEnabled);
  const cloudPlans = useCloudPlans();
  const localAgents = useAgents(localEnabled);
  const localBackendStatus = useBackendStatus(undefined, localEnabled);
  const { aggregateStatus: daemonStatus, devices: daemonDevices } = useDaemonStatus();
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

  const hasUnseenPlans = useMemo(
    () =>
      plans.some((plan) =>
        (mode === 'cloud' ? cloudPlanState : localPlanState).isUnseen(plan.id, plan.updatedAt),
      ),
    [plans, mode, cloudPlanState, localPlanState],
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
    if (syncing) return { label: 'Syncing', color: 'var(--warning)' };
    if (mode === 'cloud') {
      if (backendStatus === 'online' && plans.length === 0 && !error)
        return { label: 'Syncing', color: 'var(--warning)' };
      if (backendStatus === 'online') return { label: 'Cloud', color: 'var(--success)' };
      if (backendStatus === 'checking') return { label: 'Checking', color: 'var(--warning)' };
      return { label: 'Offline', color: 'var(--danger)' };
    }
    if (backendStatus === 'online') return { label: 'Live', color: 'var(--success)' };
    if (backendStatus === 'checking') return { label: 'Checking', color: 'var(--warning)' };
    return { label: 'Offline', color: 'var(--danger)' };
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
    planState: mode === 'cloud' ? cloudPlanState : localPlanState,
    totalPlans,
    activeAgents,
    backendIndicator,
    daemonDevices,
    daemonStatus,
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

function PlanHeaderExtra({
  plan,
  isPro,
  mode,
}: {
  plan: Plan;
  isPro: boolean;
  mode: DashboardMode;
}) {
  if (!isPro) return undefined;
  return (
    <>
      <PlanTagsBar planId={plan.id} />
      {mode === 'cloud' && <CloudPlannotatorBadge plan={plan} />}
    </>
  );
}

function DashboardMain({
  mode,
  isPro,
  isWorkspaceAccessLoading,
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
  onToggleChart,
  onSearch,
  isSplitView,
  splitPlan,
  onCloseSplit,
  outlineHidden,
  chartHidden,
}: {
  mode: DashboardMode;
  isPro: boolean;
  isWorkspaceAccessLoading: boolean;
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
  onToggleChart?: () => void;
  onSearch: () => void;
  isSplitView?: boolean;
  splitPlan?: Plan;
  onCloseSplit?: () => void;
  outlineHidden?: boolean;
  chartHidden?: boolean;
}) {
  // Entitlements resolve after auth/session rehydration; don't show the paywall during that gap.
  if (mode === 'cloud' && isWorkspaceAccessLoading) {
    return (
      <div
        className="agendex-main-pane overflow-auto main-scroll col-start-2 row-start-2 bg-transparent"
        style={{ viewTransitionName: 'main-content' }}
      >
        <BootLoadingView fullscreen={false} />
      </div>
    );
  }

  if (
    isSplitView &&
    splitPlan &&
    selectedPlan &&
    !editing &&
    !creating &&
    !uploading &&
    !showHistory
  ) {
    return (
      <div
        className="agendex-main-pane col-start-2 row-start-2 bg-transparent grid overflow-hidden"
        style={{
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gridTemplateRows: 'auto 1fr',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <div
          className="col-span-2 flex items-center justify-center gap-3 px-4 py-1.5 border-b border-border bg-surface"
          style={{ fontSize: '12px', color: 'var(--secondary)' }}
        >
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-3.5 h-3.5 opacity-50"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 4.5v15m6-15v15M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z"
            />
          </svg>
          <span>Split View</span>
          <button
            type="button"
            onClick={onCloseSplit}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium font-[inherit] rounded-md border border-border bg-transparent text-tertiary cursor-pointer hover:text-secondary hover:border-[var(--tertiary)] transition-colors duration-150"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-2.5 h-2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
            Close
          </button>
        </div>
        <div className="main-scroll overflow-auto" style={{ minWidth: 0 }}>
          <PlanViewer
            plan={selectedPlan}
            mode="split"
            onEdit={onEdit}
            onChartWideChange={onChartWideChange}
            onToggleChart={onToggleChart}
            onHistory={isPro ? onHistory : undefined}
            onShare={isPro ? onShare : undefined}
            headerExtra={<PlanHeaderExtra plan={selectedPlan} isPro={isPro} mode={mode} />}
            chartHidden={chartHidden}
          />
          {isPro && mode === 'cloud' && (
            <div className="mx-auto px-6 pb-16">
              <CloudPlannotatorWritebackPanel plan={selectedPlan} />
              <CommentThread planId={selectedPlan.id} isOwner />
            </div>
          )}
        </div>
        <div className="overflow-auto border-l border-border" style={{ minWidth: 0 }}>
          <PlanViewer
            plan={splitPlan}
            mode="split"
            onChartWideChange={onChartWideChange}
            onToggleChart={onToggleChart}
            onHistory={isPro ? onHistory : undefined}
            onShare={isPro ? onShare : undefined}
            headerExtra={<PlanHeaderExtra plan={splitPlan} isPro={isPro} mode={mode} />}
            chartHidden={chartHidden}
          />
          {isPro && mode === 'cloud' && (
            <div className="mx-auto px-6 pb-16">
              <CloudPlannotatorWritebackPanel plan={splitPlan} />
              <CommentThread planId={splitPlan.id} isOwner />
            </div>
          )}
        </div>
        {sharing && isPro && (
          <SharePlanDialog plan={selectedPlan} mode={mode} onClose={onCloseShare} />
        )}
      </div>
    );
  }

  return (
    <div
      className="agendex-main-pane overflow-auto main-scroll col-start-2 row-start-2 bg-transparent"
      style={{ viewTransitionName: 'main-content' }}
    >
      {mode === 'cloud' && !isPro ? (
        <CloudUpgrade />
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
              onToggleChart={onToggleChart}
              onHistory={isPro ? onHistory : undefined}
              onShare={isPro ? onShare : undefined}
              headerExtra={<PlanHeaderExtra plan={selectedPlan} isPro={isPro} mode={mode} />}
              outlineHidden={outlineHidden}
              chartHidden={chartHidden}
            />
            {isPro && mode === 'cloud' && (
              <div className="max-w-[720px] mx-auto px-8 pb-16">
                <CloudPlannotatorWritebackPanel plan={selectedPlan} />
                <CommentThread planId={selectedPlan.id} isOwner />
              </div>
            )}
            {sharing && isPro && (
              <SharePlanDialog plan={selectedPlan} mode={mode} onClose={onCloseShare} />
            )}
          </>
        )
      ) : (
        <EmptyStateView onSearch={onSearch} planCount={totalPlans} agents={agents} />
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
  splitPlanId,
  onOpenInSplitView,
  planState,
  onRenamePlan,
  onDeletePlan,
  width,
  onResize,
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
  onSelectPlan: (plan: Plan | undefined) => void;
  onNewPlan: () => void;
  onUpload: () => void;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
  planState: PlanState;
  onRenamePlan?: (planId: string, newTitle: string) => void;
  onDeletePlan?: (planId: string) => void;
  width?: number;
  onResize?: (width: number) => void;
}) {
  const folderState = usePlanFolders();
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const hasManyPlans = !loading && !error && filteredPlans.length > 12;

  const updateScrollTopVisibility = useCallback(
    (node: HTMLDivElement | null = scrollViewportRef.current) => {
      const hasScrollableOverflow = node ? node.scrollHeight > node.clientHeight + 120 : false;
      setShowScrollTop(
        Boolean(node && hasManyPlans && hasScrollableOverflow && node.scrollTop > 220),
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
    <aside
      className="agendex-sidebar flex flex-col overflow-hidden col-start-1 row-start-2 bg-surface min-w-0 origin-top-left"
      onMouseEnter={onRevealHover}
      onMouseLeave={onScheduleClose}
      style={{
        position: sidebarHidden ? 'absolute' : 'relative',
        top: sidebarHidden ? 0 : undefined,
        left: sidebarHidden ? 0 : undefined,
        height: sidebarHidden ? '100%' : undefined,
        width: `${width ?? 260}px`,
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
          ? 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease'
          : 'opacity 120ms ease',
      }}
    >
      {onResize && !sidebarHidden && <SidebarResizeHandle onResize={onResize} />}
      <div
        className="sidebar-command-zone"
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
          <div className="sidebar-command-strip">
            <button
              type="button"
              onClick={onNewPlan}
              className="sidebar-primary-action flex-1 px-3 text-[12px] font-semibold tracking-[0] cursor-pointer flex items-center justify-center gap-1.5 border-none"
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
              className="sidebar-icon-action"
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
        ref={scrollViewportRef}
        className="flex-1 overflow-auto sidebar-scroll sidebar-content-list"
        onScroll={(event) => updateScrollTopVisibility(event.currentTarget)}
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
            splitPlanId={splitPlanId}
            onOpenInSplitView={onOpenInSplitView}
            planState={planState}
            onRenamePlan={onRenamePlan}
            onDeletePlan={onDeletePlan}
            folderState={folderState}
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
    </aside>
  );
}

type Panel = 'editing' | 'creating' | 'uploading' | 'history' | 'sharing' | null;

type DashState = {
  selectedTags: string[];
  selectedCollection: string | undefined;
  activePanel: Panel;
  showPricingModal: boolean;
  sidebarHidden: boolean;
  sidebarPeek: boolean;
  outlineHidden: boolean;
  chartHidden: boolean;
};

type DashAction =
  | { type: 'SET_TAGS'; value: string[] }
  | { type: 'SET_COLLECTION'; value: string | undefined }
  | { type: 'SET_PANEL'; value: Panel }
  | { type: 'SET_PRICING_MODAL'; value: boolean }
  | { type: 'SET_SIDEBAR_HIDDEN'; value: boolean }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_PEEK'; value: boolean }
  | { type: 'TOGGLE_OUTLINE' }
  | { type: 'TOGGLE_CHART' };

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
    case 'SET_SIDEBAR_HIDDEN':
      return { ...s, sidebarHidden: a.value, sidebarPeek: false };
    case 'TOGGLE_SIDEBAR':
      return { ...s, sidebarHidden: !s.sidebarHidden, sidebarPeek: false };
    case 'SET_SIDEBAR_PEEK':
      return { ...s, sidebarPeek: a.value };
    case 'TOGGLE_OUTLINE':
      return { ...s, outlineHidden: !s.outlineHidden };
    case 'TOGGLE_CHART':
      return { ...s, chartHidden: !s.chartHidden };
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
  const [splitPlanId, setSplitPlanId] = useQueryState(
    'split',
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
    sidebarHidden: localStorage.getItem(SIDEBAR_PREF_KEY) === 'true',
    sidebarPeek: false,
    outlineHidden: localStorage.getItem(OUTLINE_PREF_STORAGE_KEY) === 'true',
    chartHidden: localStorage.getItem(CHART_PREF_STORAGE_KEY) === 'true',
  });

  const {
    selectedTags,
    selectedCollection,
    activePanel,
    showPricingModal,
    sidebarHidden,
    sidebarPeek,
    outlineHidden,
    chartHidden,
  } = ds;
  const mode = autoMode;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const setSelectedTags = (v: string[]) => dsd({ type: 'SET_TAGS', value: v });
  const setSelectedCollection = (v: string | undefined) =>
    dsd({ type: 'SET_COLLECTION', value: v });
  const setActivePanel = useCallback((v: Panel) => dsd({ type: 'SET_PANEL', value: v }), []);
  const setShowPricingModal = (v: boolean) => dsd({ type: 'SET_PRICING_MODAL', value: v });
  const setSidebarHidden = (v: boolean) => dsd({ type: 'SET_SIDEBAR_HIDDEN', value: v });
  const setSidebarPeek = (v: boolean) => dsd({ type: 'SET_SIDEBAR_PEEK', value: v });

  const editing = activePanel === 'editing';
  const creating = activePanel === 'creating';
  const uploading = activePanel === 'uploading';
  const showHistory = activePanel === 'history';
  const sharing = activePanel === 'sharing';
  const sidebarBeforeWide = useRef<boolean | null>(null);
  const { canAccessCloud: isPro, isLoading: isWorkspaceAccessLoading } = useWorkspaceAccess();
  const localPlanState = usePlanState();
  const cloudPlanState = useCloudPlanPreferences();

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
    planState,
    totalPlans,
    activeAgents,
    backendIndicator,
    daemonDevices,
    daemonStatus,
  } = useDashboardData(
    mode,
    agentFilter,
    sortBy,
    dateBucket,
    search,
    selectedTags,
    selectedCollection,
    isPro,
    localPlanState,
    cloudPlanState,
  );

  const plansById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const [expandedWidth, setExpandedWidth] = useSidebarWidth();

  const sidebarPinnedOpen = !sidebarHidden;
  const sidebarPeekOpen = sidebarHidden && sidebarPeek;
  const sidebarVisible = sidebarPinnedOpen || sidebarPeekOpen;
  const sidebarWidth = sidebarPinnedOpen ? expandedWidth : 0;

  const peek = useSidebarPeek(sidebarHidden, setSidebarPeek);
  const [optimisticSelectedPlan, setOptimisticSelectedPlan] = useState<Plan | undefined>(undefined);
  const [localAutoSelectSuppressed, setLocalAutoSelectSuppressed] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_PREF_KEY, sidebarHidden ? 'true' : 'false');
  }, [sidebarHidden]);

  useEffect(() => {
    localStorage.setItem(OUTLINE_PREF_STORAGE_KEY, outlineHidden ? 'true' : 'false');
  }, [outlineHidden]);

  useEffect(() => {
    localStorage.setItem(CHART_PREF_STORAGE_KEY, chartHidden ? 'true' : 'false');
  }, [chartHidden]);

  const selectedPlan = useMemo(() => {
    const localFallback =
      mode === 'local' && !localAutoSelectSuppressed ? filteredPlans[0] : undefined;
    if (selectedPlanId) {
      return (
        filteredPlans.find((p) => p.id === selectedPlanId) ??
        plans.find((p) => p.id === selectedPlanId) ??
        (optimisticSelectedPlan?.id === selectedPlanId ? optimisticSelectedPlan : undefined) ??
        localFallback
      );
    }
    return localFallback;
  }, [
    filteredPlans,
    plans,
    optimisticSelectedPlan,
    selectedPlanId,
    mode,
    localAutoSelectSuppressed,
  ]);

  const splitPlan = useMemo(() => {
    if (!splitPlanId) return undefined;
    return plansById.get(splitPlanId) ?? plans.find((p) => p.id === splitPlanId);
  }, [plansById, plans, splitPlanId]);

  const isSplitView = !!selectedPlan && !!splitPlan && selectedPlan.id !== splitPlan.id;
  const effectiveChartHidden = !isPro && !isWorkspaceAccessLoading ? false : chartHidden;

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => {
      setLocalAutoSelectSuppressed(!plan);
      setOptimisticSelectedPlan(plan);
      setSelectedPlanId(plan?.id ?? null);
      if (!plan || splitPlanId === plan.id) {
        setSplitPlanId(null);
      }
    },
    [setSelectedPlanId, splitPlanId, setSplitPlanId],
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

  const openPlanInSplitView = useCallback(
    (plan: Plan) => {
      if (!selectedPlanId) {
        setSelectedPlanId(plan.id);
        return;
      }
      if (plan.id === selectedPlanId) return;
      setSplitPlanId(plan.id);
    },
    [selectedPlanId, setSelectedPlanId, setSplitPlanId],
  );

  const closeSplitView = useCallback(() => {
    setSplitPlanId(null);
  }, [setSplitPlanId]);

  useEffect(() => {
    if (splitPlanId && splitPlanId === selectedPlanId) {
      setSplitPlanId(null);
    }
  }, [splitPlanId, selectedPlanId, setSplitPlanId]);

  function handleSaved() {
    setActivePanel(null);
    refresh();
  }

  function toggleSidebar() {
    peek.clear();
    dsd({ type: 'TOGGLE_SIDEBAR' });
  }

  function toggleOutline() {
    dsd({ type: 'TOGGLE_OUTLINE' });
  }

  function restoreSidebarAfterWide() {
    if (sidebarBeforeWide.current) setSidebarHidden(false);
    sidebarBeforeWide.current = null;
  }

  function toggleChart() {
    if (!isPro) return;
    if (!chartHidden && sidebarBeforeWide.current !== null) {
      restoreSidebarAfterWide();
    }
    dsd({ type: 'TOGGLE_CHART' });
  }

  useHotkey('Mod+B', toggleSidebar);
  useHotkey('Mod+Shift+O', toggleOutline);
  useHotkey('Mod+Shift+G', toggleChart);

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

  const renamePlanMutation = useMutation(api.plans.renamePlan);
  const handleRenamePlan = useCallback(
    async (planId: string, newTitle: string) => {
      if (mode !== 'cloud' || !isPro) return;
      await renamePlanMutation({ planId: planId as Id<'plans'>, title: newTitle });
    },
    [mode, isPro, renamePlanMutation],
  );

  const deletePlanMutation = useMutation(api.plans.deletePlan);
  const handleDeletePlan = useCallback(
    async (planId: string) => {
      if (mode !== 'cloud' || !isPro) return;
      await deletePlanMutation({ planId: planId as Id<'plans'> });
      startViewTransition(() =>
        setSelectedPlan(selectedPlan?.id === planId ? undefined : selectedPlan),
      );
      setSplitPlanId((prev) => (prev === planId ? null : prev));
    },
    [mode, isPro, deletePlanMutation, setSelectedPlan, setSplitPlanId, selectedPlan],
  );

  function handleChartWideChange(wide: boolean) {
    if (wide) {
      sidebarBeforeWide.current = !sidebarHidden;
      if (!sidebarHidden) setSidebarHidden(true);
    } else {
      restoreSidebarAfterWide();
    }
  }

  return (
    <div
      className="agendex-app-shell h-screen grid overflow-clip relative"
      data-plan-open={selectedPlan ? 'true' : undefined}
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
        onHistory={() => startViewTransition(() => setActivePanel('history'))}
        onNavigate={(path: string) => startViewTransition(() => navigate(path))}
        daemonDevices={daemonDevices}
        daemonAggregateStatus={daemonStatus}
        onShowPricing={() => setShowPricingModal(true)}
        splitPlanId={splitPlanId ?? undefined}
        onOpenInSplitView={openPlanInSplitView}
        onCloseSplit={splitPlanId ? closeSplitView : undefined}
        planState={planState}
        onToggleOutline={toggleOutline}
        onToggleChart={isPro ? toggleChart : undefined}
        onDeletePlan={mode === 'cloud' && isPro ? handleDeletePlan : undefined}
        onShowChangelog={() => startViewTransition(() => navigate('/changelog'))}
        sidebarWidth={expandedWidth}
      />

      {mode === 'local' && (
        <>
          <button
            type="button"
            onClick={() => setSourcesOpen(true)}
            title="Manage plan sources"
            className="fixed z-50 w-[30px] h-[30px] rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center"
            style={{ top: 20, right: 60 }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>

          <PlanSourcesDialog
            open={sourcesOpen}
            onClose={() => setSourcesOpen(false)}
            onSourcesChanged={() => refresh()}
          />
        </>
      )}

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
        splitPlanId={splitPlanId ?? undefined}
        onOpenInSplitView={(plan: Plan) => startViewTransition(() => openPlanInSplitView(plan))}
        planState={planState}
        onRenamePlan={mode === 'cloud' && isPro ? handleRenamePlan : undefined}
        onDeletePlan={mode === 'cloud' && isPro ? handleDeletePlan : undefined}
        width={expandedWidth}
        onResize={setExpandedWidth}
      />

      <DashboardMain
        mode={mode}
        isPro={isPro}
        isWorkspaceAccessLoading={isWorkspaceAccessLoading}
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
        onToggleChart={isPro ? toggleChart : undefined}
        onSearch={() => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          );
        }}
        isSplitView={isSplitView}
        splitPlan={splitPlan}
        onCloseSplit={closeSplitView}
        outlineHidden={outlineHidden}
        chartHidden={effectiveChartHidden}
      />

      {showPricingModal && <PricingModal onClose={() => setShowPricingModal(false)} />}
      <LocalIpDisclosureNotice enabled={mode === 'cloud' && isPro && !isWorkspaceAccessLoading} />
    </div>
  );
}

function ChangelogRoute() {
  const [, navigate] = useLocation();
  return <ChangelogPage onBack={() => startViewTransition(() => navigate('/'))} />;
}

function CliAuthRoute() {
  const callback = new URLSearchParams(window.location.search).get('callback');
  if (!callback) return <Redirect to="/" />;
  return <CliAuthPage callbackUrl={callback} />;
}

/**
 * Route mounted at /auth/check on the app host.
 * The marketing site redirects here so we can check localStorage (which lives
 * on the app origin) and either keep the user on the app or bounce them back.
 */
function AuthCheckRoute() {
  const { isAuthenticated, isLoading, refreshSession } = useAuth();
  const authSettled = useAuthSessionSettled({ isAuthenticated, isLoading, refreshSession });
  const appUrl = normalizeLocalDevUrl(import.meta.env.VITE_APP_URL as string | undefined);
  const marketingUrl = normalizeLocalDevUrl(
    import.meta.env.VITE_MARKETING_URL as string | undefined,
  );
  const returnTo = new URLSearchParams(window.location.search).get('returnTo');

  useEffect(() => {
    if (!authSettled) return;
    if (isAuthenticated) {
      window.location.replace('/');
    } else if (returnTo || marketingUrl) {
      try {
        const redirectTarget = returnTo ?? marketingUrl;
        const normalizedRedirectTarget = normalizeLocalDevUrl(redirectTarget ?? undefined);
        if (!normalizedRedirectTarget) {
          window.location.replace('/');
          return;
        }
        const dest = new URL(normalizedRedirectTarget);
        const trusted = new Set([getNormalizedOrigin(appUrl), getNormalizedOrigin(marketingUrl)]);
        if (!trusted.has(dest.origin)) {
          window.location.replace('/');
          return;
        }
        dest.searchParams.set('checked', '1');
        window.location.replace(dest.toString());
      } catch {
        window.location.replace('/');
      }
    }
  }, [authSettled, isAuthenticated, returnTo, marketingUrl, appUrl]);

  return <BootLoadingView />;
}

function HomeRoute() {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading, refreshSession, signIn } = useAuth();
  const hasCachedToken = hasToken();
  const { needsOnboarding, onboardingResolved } = useSubscription({
    enabled: !isLoading && isAuthenticated,
  });

  // Track whether we arrived with an OTT token (OAuth callback).
  // The ConvexBetterAuthProvider will process it, but the auto-fetch from
  // useSession resolves with null first — creating a transient unauth state.
  // Suppress redirects until the OTT flow has a chance to establish the session.
  const [processingOtt, setProcessingOtt] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('ott'),
  );
  useEffect(() => {
    if (processingOtt && isAuthenticated) setProcessingOtt(false);
  }, [processingOtt, isAuthenticated]);
  useEffect(() => {
    if (!processingOtt) return;
    const id = setTimeout(() => setProcessingOtt(false), 5_000);
    return () => clearTimeout(id);
  }, [processingOtt]);

  const authSettled = useAuthSessionSettled({
    isAuthenticated,
    isLoading,
    refreshSession,
    hold: processingOtt,
    skip: hasCachedToken,
  });

  const appUrl = normalizeLocalDevUrl(import.meta.env.VITE_APP_URL as string | undefined);
  const marketingUrl = normalizeLocalDevUrl(
    import.meta.env.VITE_MARKETING_URL as string | undefined,
  );

  let isAppHost = false;
  let isMarketingHost = false;
  isAppHost = isOriginTrustedByUrl(window.location.origin, appUrl);
  isMarketingHost = isOriginTrustedByUrl(window.location.origin, marketingUrl);
  // Treat the apex domain (e.g. agendex.dev) as the marketing host.
  if (!isAppHost && !isMarketingHost && getApexHost(marketingUrl) === window.location.hostname) {
    isMarketingHost = true;
  }

  // On the marketing host, bounce to the app host's /auth/check so it can
  // inspect its own localStorage for an existing session.
  // Skip if we already checked (indicated by ?checked=1 from AuthCheckRoute).
  const alreadyChecked = new URLSearchParams(window.location.search).get('checked') === '1';
  useEffect(() => {
    if (isMarketingHost && appUrl && authSettled && !isAuthenticated && !alreadyChecked) {
      const checkUrl = new URL('/auth/check', appUrl);
      checkUrl.searchParams.set('returnTo', window.location.href);
      window.location.replace(checkUrl.toString());
    }
  }, [isMarketingHost, appUrl, authSettled, isAuthenticated, alreadyChecked]);

  useEffect(() => {
    if (isAuthenticated && onboardingResolved && !needsOnboarding && isMarketingHost && appUrl) {
      window.location.href = appUrl;
    }
  }, [isAuthenticated, onboardingResolved, needsOnboarding, isMarketingHost, appUrl]);

  useEffect(() => {
    if (
      !isAuthenticated &&
      authSettled &&
      !hasCachedToken &&
      isAppHost &&
      marketingUrl &&
      !processingOtt
    ) {
      window.location.href = marketingUrl;
    }
  }, [isAuthenticated, authSettled, hasCachedToken, isAppHost, marketingUrl, processingOtt]);

  if (isMarketingHost && appUrl && !isAuthenticated && !alreadyChecked) return <BootLoadingView />;

  if (isAuthenticated && isMarketingHost && appUrl) return <BootLoadingView />;

  if (isAuthenticated && onboardingResolved && needsOnboarding) return <Redirect to="/welcome" />;

  if (hasCachedToken) {
    return <Dashboard autoMode={isAuthenticated && onboardingResolved ? 'cloud' : 'local'} />;
  }

  if (isAuthenticated) {
    if (!onboardingResolved) return <BootLoadingView />;
    return <Dashboard autoMode="cloud" />;
  }

  if (isLoading || !authSettled || processingOtt) return <BootLoadingView />;

  if (isAppHost && marketingUrl) return <BootLoadingView />;

  const handleLogin = (provider: 'github' | 'google') =>
    signIn.social({ provider, callbackURL: `${APP_URL}/` });

  return (
    <LandingPage
      mascot={{ onActivate: () => startViewTransition(() => navigate('/about-me')) }}
      onShowChangelog={() => startViewTransition(() => navigate('/changelog'))}
    >
      <LandingPage.NavbarAuth>
        {() => <EENavbarAuth onLogin={handleLogin} />}
      </LandingPage.NavbarAuth>
      <LandingPage.HeroCta>{() => <EEHeroCta onLogin={handleLogin} />}</LandingPage.HeroCta>
      <LandingPage.PricingCta>
        {() => <EEPricingCta onLogin={handleLogin} />}
      </LandingPage.PricingCta>
    </LandingPage>
  );
}

function AppAvatarProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const avatars = useQuery(api.agentAvatars.listMyAgentAvatars, isAuthenticated ? {} : 'skip');
  return <AgentAvatarProvider avatars={avatars ?? {}}>{children}</AgentAvatarProvider>;
}

export default function App() {
  return (
    <AppAvatarProvider>
      <Switch>
        <Route path="/auth/check" component={AuthCheckRoute} />
        <Route path="/auth/cli" component={CliAuthRoute} />
        <Route path="/login">{() => <AuthPage mode="login" />}</Route>
        <Route path="/signup">{() => <AuthPage mode="signup" />}</Route>
        <Route path="/shared/:token">{({ token }) => <SharedPlanView token={token} />}</Route>
        <Route path="/about-me" component={AboutMePage} />
        <Route path="/changelog" component={ChangelogRoute} />
        <Route path="/welcome">
          <OnboardingRoute>
            <WelcomeScreen />
          </OnboardingRoute>
        </Route>
        <Route path="/invite/:token">{({ token }) => <AcceptInvitePage token={token} />}</Route>
        <Route path="/settings" component={SettingsPage} />
        <Route path="/" component={HomeRoute} />
      </Switch>
    </AppAvatarProvider>
  );
}
