import {
  AgentAvatarProvider,
  type AgentStats,
  ChangelogPage,
  DocsPage,
  EmptyStateView,
  filterPlans,
  hasToken,
  LandingPage,
  MAX_FOLDERS,
  OfflineView,
  type Plan,
  PlanList,
  PlanActionButton,
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
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useMutation, useQuery } from 'convex/react';
import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from 'motion/react';
import { parseAsString, parseAsStringLiteral, throttle, useQueryState, useQueryStates } from 'nuqs';
import {
  lazy,
  Suspense,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  CloudPlanAnnotationsPanel,
  useCloudPlanAnnotations,
} from './components/CloudPlanAnnotationsPanel.tsx';
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
import { useCloudPlanContent } from './hooks/useCloudPlanContent.ts';
import { useCloudPlanPreferences } from './hooks/useCloudPlanPreferences.ts';
import { useCloudPlans } from './hooks/useCloudPlans.ts';
import { useCloudPlanSearch } from './hooks/useCloudPlanSearch.ts';
import { useDaemonStatus } from './hooks/useDaemonStatus.ts';
import { useSubscription } from './hooks/useSubscription.ts';
import { useSyncIndicator } from './hooks/useSyncIndicator.ts';
import { useWorkspaceAccess } from './hooks/useWorkspaceAccess.ts';
import { authClient, normalizeLocalDevUrl } from './lib/auth-client.ts';
import { convex } from './lib/convex-client.ts';
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
const DASHBOARD_PATH = '/dashboard';

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

function getLocalDevAppUrl(): string {
  if (typeof window === 'undefined') return '';
  if (!window.location.hostname.endsWith('agendex.localhost')) return '';

  const url = new URL(window.location.href);
  url.hostname = 'app.agendex.localhost';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return normalizeLocalDevUrl(url.toString());
}

function getLocalDevMarketingUrl(): string {
  if (typeof window === 'undefined') return '';
  if (!window.location.hostname.endsWith('agendex.localhost')) return '';

  const url = new URL(window.location.href);
  url.hostname = 'agendex.localhost';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return normalizeLocalDevUrl(url.toString());
}

function getMarketingUrlFromAppUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl);
    if (!url.hostname.startsWith('app.')) return '';
    url.hostname = url.hostname.slice('app.'.length);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return normalizeLocalDevUrl(url.toString());
  } catch {
    return '';
  }
}

function getConfiguredAppUrl(): string {
  return (
    normalizeLocalDevUrl(import.meta.env.VITE_APP_URL as string | undefined) || getLocalDevAppUrl()
  );
}

function getConfiguredMarketingUrl(appUrl = getConfiguredAppUrl()): string {
  return (
    normalizeLocalDevUrl(import.meta.env.VITE_MARKETING_URL as string | undefined) ||
    getLocalDevMarketingUrl() ||
    getMarketingUrlFromAppUrl(appUrl)
  );
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
  const cloudBackendStatus = cloudPlans.loading
    ? 'checking'
    : cloudPlans.error
      ? 'offline'
      : 'online';
  const backendStatus = mode === 'cloud' ? cloudBackendStatus : localBackendStatus;
  const cloudSyncPaused = mode === 'cloud' && daemonStatus === 'stale';

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

  // Cloud list items ship without `content`, so content matching runs
  // server-side; the returned ids union into filterPlans' metadata matches.
  const cloudContentMatchIds = useCloudPlanSearch(mode === 'cloud' ? search : '');

  const filteredPlans = useMemo(() => {
    let result = filterPlans(plans, search, mode === 'cloud' ? cloudContentMatchIds : undefined);
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
    cloudContentMatchIds,
  ]);

  const refreshLocalPlans = localPlans.refresh;
  const prevBackendStatus = useRef(backendStatus);
  useEffect(() => {
    if (prevBackendStatus.current === 'offline' && backendStatus === 'online') {
      refreshLocalPlans();
    }
    prevBackendStatus.current = backendStatus;
  }, [backendStatus, refreshLocalPlans]);

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
      if (backendStatus === 'online' && cloudSyncPaused)
        return { label: 'Sync paused', color: 'var(--warning)' };
      if (backendStatus === 'online' && plans.length === 0 && !error)
        return { label: 'Syncing', color: 'var(--warning)' };
      if (backendStatus === 'online') return { label: 'Cloud', color: 'var(--success)' };
      if (backendStatus === 'checking') return { label: 'Checking', color: 'var(--warning)' };
      return { label: 'Offline', color: 'var(--danger)' };
    }
    if (backendStatus === 'online') return { label: 'Live', color: 'var(--success)' };
    if (backendStatus === 'checking') return { label: 'Checking', color: 'var(--warning)' };
    return { label: 'Offline', color: 'var(--danger)' };
  }, [backendStatus, mode, syncing, plans.length, error, cloudSyncPaused]);

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
    cloudSyncPaused,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPlanPlannotatorMetadata(plan: Plan): Record<string, unknown> | undefined {
  const metadata = isRecord(plan.metadata) ? plan.metadata.plannotator : undefined;
  return isRecord(metadata) ? metadata : undefined;
}

function isLivePlannotatorSession(plan: Plan): boolean {
  const metadata = getPlanPlannotatorMetadata(plan);
  // Proven live only (`liveness === 'live'`), matching the Plannotator badge's
  // reachability check and the backend's `planHasLivePlannotatorMetadata`.
  return (
    metadata?.kind === 'live-session' &&
    metadata.writebackCapable === true &&
    metadata.liveness === 'live'
  );
}

function isEndedPlannotatorSession(plan: Plan): boolean {
  const metadata = getPlanPlannotatorMetadata(plan);
  return (
    metadata?.kind === 'live-session' &&
    (metadata.liveness === 'ended' || metadata.writebackCapable === false)
  );
}

// All continuity keys a session could be indexed under, in descending
// specificity. Must mirror `plannotatorContinuityKeys` in the backend
// (convex/plannotator.ts and convex/cli.ts) so auto-follow tracks the same
// canonical plan that write-back resolution targets.
function plannotatorContinuityKeys(plan: Plan): string[] {
  const metadata = getPlanPlannotatorMetadata(plan);
  if (metadata?.kind !== 'live-session') return [];

  const keys: string[] = [];

  const sourcePlanPath =
    typeof metadata.sourcePlanPath === 'string' ? metadata.sourcePlanPath.trim() : '';
  if (sourcePlanPath) keys.push(`source:${sourcePlanPath}`);

  const reviewId = typeof metadata.reviewId === 'string' ? metadata.reviewId.trim() : '';
  if (reviewId) keys.push(`review:${reviewId}`);

  const project = typeof metadata.project === 'string' ? metadata.project.trim() : '';
  const label = typeof metadata.label === 'string' ? metadata.label.trim() : '';
  const mode = typeof metadata.mode === 'string' ? metadata.mode.trim() : '';
  if (project && label) keys.push(`project:${project}:label:${label}:mode:${mode}`);

  const path = plan.filePath?.trim();
  if (path) keys.push(`path:${path}`);

  const sessionPath = typeof metadata.sessionPath === 'string' ? metadata.sessionPath.trim() : '';
  if (sessionPath) keys.push(`path:${sessionPath}`);

  return keys;
}

function getSupersededByPlanId(plan: Plan): string | undefined {
  const metadata = getPlanPlannotatorMetadata(plan);
  const value = metadata?.supersededByPlanId;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function findLivePlannotatorReplacement(plan: Plan, plans: Plan[]): Plan | undefined {
  if (!isEndedPlannotatorSession(plan)) return undefined;

  // Mirror the backend's `findCurrentLivePlannotatorPlan`: collect every live
  // candidate reached via supersession pointers AND via shared continuity keys,
  // then pick the newest. Never short-circuit on a pointer target, so a
  // stale-but-live pointer row cannot beat a newer replacement.
  const byId = new Map(plans.map((p) => [p.id, p]));
  const liveCandidates: Plan[] = [];
  const seen = new Set<string>();
  const keySet = new Set<string>();
  const consider = (candidate: Plan): void => {
    if (seen.has(candidate.id)) return;
    seen.add(candidate.id);
    if (candidate.id !== plan.id && isLivePlannotatorSession(candidate)) {
      liveCandidates.push(candidate);
    }
  };

  // Follow supersession pointers, folding each hop's continuity keys into the set.
  let current: Plan | undefined = plan;
  const visited = new Set<string>([plan.id]);
  for (let hops = 0; hops < 16 && current; hops++) {
    consider(current);
    for (const key of plannotatorContinuityKeys(current)) keySet.add(key);
    const nextId = getSupersededByPlanId(current);
    if (!nextId || visited.has(nextId)) break;
    visited.add(nextId);
    current = byId.get(nextId);
  }

  if (keySet.size === 0) return undefined;
  for (const candidate of plans) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (candidate.id === plan.id || !isLivePlannotatorSession(candidate)) continue;
    // Match on any shared continuity key (set intersection), mirroring the
    // backend so cross-scheme replacements (e.g. legacy `path:` vs new `source:`)
    // that share only a fallback key still resolve.
    if (!plannotatorContinuityKeys(candidate).some((candidateKey) => keySet.has(candidateKey))) {
      continue;
    }
    liveCandidates.push(candidate);
  }

  // Newest session wins, with a stable `id` tiebreaker. Must stay in sync with
  // the backend's `findCurrentLivePlannotatorPlan` so the UI follows the same
  // canonical plan that receives write-backs.
  return liveCandidates.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || (a.id < b.id ? 1 : -1),
  )[0];
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

function CloudSyncPausedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--warning)_45%,transparent)] bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
      <span className="size-1.5 rounded-full bg-[var(--warning)]" />
      Sync paused
    </span>
  );
}

function CloudSyncPausedNotice() {
  return (
    <div className="sticky top-0 z-30 border-b border-[color-mix(in_oklch,var(--warning)_35%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_9%,var(--surface))] px-4 py-2.5 text-[12.5px] text-secondary backdrop-blur">
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CloudSyncPausedBadge />
          <span>
            Showing synced cloud plans. New local file changes will appear after the CLI daemon is
            running again.
          </span>
        </div>
        <code className="rounded-md border border-border bg-bg px-2 py-1 text-[11px] text-text">
          agendex start
        </code>
      </div>
    </div>
  );
}

type CloudAnnotationState = ReturnType<typeof useCloudPlanAnnotations>;
type ToolbarOptionPlacement = 'left' | 'right' | 'stack';
type ReviewRailLayoutStyle = CSSProperties & {
  '--plannotator-review-document-left'?: string;
  '--plannotator-review-document-right'?: string;
};

const TOOLBAR_OPTION_ENTER_EASE = [0.22, 1, 0.36, 1] as const;
const TOOLBAR_OPTION_EXIT_EASE = [0.4, 0, 1, 1] as const;
const TOOLBAR_OPTION_LEFT_RAIL_WIDTH = 282;
const TOOLBAR_OPTION_RIGHT_RAIL_WIDTH = 304;
const TOOLBAR_OPTION_RAIL_GAP = 30;
const TOOLBAR_OPTION_RAIL_MARGIN = 16;

function useToolbarOptionLayoutVisibility(active: boolean): [boolean, () => void] {
  const [present, setPresent] = useState(active);

  useEffect(() => {
    if (active) setPresent(true);
  }, [active]);

  const handleExitComplete = useCallback(() => {
    if (!active) setPresent(false);
  }, [active]);

  return [active || present, handleExitComplete];
}

function getToolbarOptionHiddenState(placement: ToolbarOptionPlacement) {
  if (placement === 'left') return { opacity: 0, x: -14, y: 0, scale: 0.985 };
  if (placement === 'right') return { opacity: 0, x: 14, y: 0, scale: 0.985 };
  return { opacity: 0, x: 0, y: 10, scale: 0.985 };
}

function useToolbarOptionMotion(placement: ToolbarOptionPlacement) {
  const reduceMotion = useReducedMotion();
  const hidden = reduceMotion ? { opacity: 0 } : getToolbarOptionHiddenState(placement);
  const visible = reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, y: 0, scale: 1 };

  return {
    layout: !reduceMotion,
    initial: 'hidden',
    animate: 'visible',
    exit: 'exit',
    variants: {
      hidden,
      visible: {
        ...visible,
        transition: reduceMotion
          ? { duration: 0 }
          : { duration: 0.24, ease: TOOLBAR_OPTION_ENTER_EASE },
      },
      exit: {
        ...hidden,
        transition: reduceMotion
          ? { duration: 0 }
          : { duration: 0.18, ease: TOOLBAR_OPTION_EXIT_EASE },
      },
    },
  } as const;
}

function ToolbarOptionSurface({
  placement,
  children,
}: {
  placement: ToolbarOptionPlacement;
  children: ReactNode;
}) {
  const motion = useToolbarOptionMotion(placement);

  return (
    <m.div className="plannotator-toolbar-option-surface" data-placement={placement} {...motion}>
      {children}
    </m.div>
  );
}

function ToolbarOptionRail({
  side,
  active,
  onExitComplete,
  children,
}: {
  side: 'left' | 'right';
  active: boolean;
  onExitComplete: () => void;
  children: ReactNode;
}) {
  const motion = useToolbarOptionMotion(side);

  return (
    <AnimatePresence initial={false} onExitComplete={onExitComplete}>
      {active && (
        <m.aside
          key={`${side}-rail`}
          className={`plannotator-review-rail plannotator-review-rail--${side}`}
          {...motion}
        >
          {children}
        </m.aside>
      )}
    </AnimatePresence>
  );
}

function CloudToolbarOptionStack({
  plan,
  annotationState,
  canWriteAnnotations,
  daemonAvailable,
  showPlannotatorTools,
  showComments,
}: {
  plan: Plan;
  annotationState: CloudAnnotationState;
  canWriteAnnotations: boolean;
  daemonAvailable: boolean;
  showPlannotatorTools: boolean;
  showComments: boolean;
}) {
  const active = showPlannotatorTools || showComments;
  const [stackVisible, handleStackExitComplete] = useToolbarOptionLayoutVisibility(active);

  if (!stackVisible) return null;

  return (
    <LazyMotion features={domAnimation}>
      <div className="plannotator-review-stack mx-auto px-6 pb-16">
        <AnimatePresence initial={false} onExitComplete={handleStackExitComplete}>
          {showPlannotatorTools && (
            <ToolbarOptionSurface key="plannotator-tools" placement="stack">
              <CloudPlanAnnotationsPanel
                plan={plan}
                annotations={annotationState.annotations}
                selectedAnnotationId={annotationState.selectedAnnotationId}
                onSelectAnnotation={annotationState.setSelectedAnnotationId}
                canWriteAnnotations={canWriteAnnotations}
                daemonAvailable={daemonAvailable}
                variant="stack"
              />
              <CloudPlannotatorWritebackPanel
                plan={plan}
                canQueueWriteback={canWriteAnnotations}
                daemonAvailable={daemonAvailable}
                variant="stack"
              />
            </ToolbarOptionSurface>
          )}
          {showComments && (
            <ToolbarOptionSurface key="comments" placement="stack">
              <CommentThread planId={plan.id} isOwner className="plannotator-comments-panel" />
            </ToolbarOptionSurface>
          )}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}

function CloudPlanReviewWorkspace({
  plan,
  mode,
  isPro,
  annotationState,
  canWriteAnnotations,
  annotationUpgradeMessage,
  daemonAvailable,
  showPlannotatorTools,
  showComments,
  actionToolbarExtra,
  outlineHidden,
  chartHidden,
  onEdit,
  onHistory,
  onShare,
  onChartWideChange,
  onToggleChart,
}: {
  plan: Plan;
  mode: DashboardMode;
  isPro: boolean;
  annotationState: CloudAnnotationState;
  canWriteAnnotations: boolean;
  annotationUpgradeMessage?: string;
  daemonAvailable: boolean;
  showPlannotatorTools: boolean;
  showComments: boolean;
  actionToolbarExtra?: ReactNode;
  outlineHidden?: boolean;
  chartHidden?: boolean;
  onEdit: () => void;
  onHistory: () => void;
  onShare: () => void;
  onChartWideChange: (wide: boolean) => void;
  onToggleChart?: () => void;
}) {
  const hasRightRail = showPlannotatorTools || showComments;
  const [leftRailVisible, handleLeftRailExitComplete] =
    useToolbarOptionLayoutVisibility(showPlannotatorTools);
  const [rightRailVisible, handleRightRailExitComplete] =
    useToolbarOptionLayoutVisibility(hasRightRail);
  const reduceMotion = useReducedMotion();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [railLayoutStyle, setRailLayoutStyle] = useState<ReviewRailLayoutStyle>({});
  const [overlayRails, setOverlayRails] = useState(false);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    let frame = 0;

    const updateRailLayout = () => {
      frame = 0;
      const documentElement = shell.querySelector('.plannotator-review-document');
      if (!(documentElement instanceof HTMLElement)) return;

      const rect = documentElement.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const nextLeft = `${Math.round(rect.left)}px`;
      const nextRight = `${Math.round(rect.right)}px`;
      const activeRails = leftRailVisible || rightRailVisible;
      const hasLeftMargin =
        !leftRailVisible ||
        rect.left >=
          TOOLBAR_OPTION_LEFT_RAIL_WIDTH + TOOLBAR_OPTION_RAIL_GAP + TOOLBAR_OPTION_RAIL_MARGIN;
      const hasRightMargin =
        !rightRailVisible ||
        viewportWidth - rect.right >=
          TOOLBAR_OPTION_RIGHT_RAIL_WIDTH + TOOLBAR_OPTION_RAIL_GAP + TOOLBAR_OPTION_RAIL_MARGIN;
      const nextOverlayRails =
        activeRails && viewportWidth > 1320 && hasLeftMargin && hasRightMargin;

      setRailLayoutStyle((current) =>
        current['--plannotator-review-document-left'] === nextLeft &&
        current['--plannotator-review-document-right'] === nextRight
          ? current
          : {
              '--plannotator-review-document-left': nextLeft,
              '--plannotator-review-document-right': nextRight,
            },
      );
      setOverlayRails((current) => (current === nextOverlayRails ? current : nextOverlayRails));
    };

    const scheduleRailLayoutUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateRailLayout);
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => scheduleRailLayoutUpdate());
    resizeObserver?.observe(shell);
    const mainPane = shell.closest('.agendex-main-pane');
    if (mainPane) resizeObserver?.observe(mainPane);

    updateRailLayout();
    window.addEventListener('resize', scheduleRailLayoutUpdate);
    window.addEventListener('agendex:plan-layout-change', scheduleRailLayoutUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleRailLayoutUpdate);
      window.removeEventListener('agendex:plan-layout-change', scheduleRailLayoutUpdate);
    };
  }, [leftRailVisible, rightRailVisible]);

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={shellRef}
        layout={!reduceMotion}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 0.24, ease: TOOLBAR_OPTION_ENTER_EASE }
        }
        className="plannotator-review-shell"
        data-left-rail={leftRailVisible ? 'true' : undefined}
        data-right-rail={rightRailVisible ? 'true' : undefined}
        data-overlay-rails={overlayRails ? 'true' : undefined}
        style={railLayoutStyle}
      >
        <ToolbarOptionRail
          side="left"
          active={showPlannotatorTools}
          onExitComplete={handleLeftRailExitComplete}
        >
          <CloudPlanAnnotationsPanel
            plan={plan}
            annotations={annotationState.annotations}
            selectedAnnotationId={annotationState.selectedAnnotationId}
            onSelectAnnotation={annotationState.setSelectedAnnotationId}
            canWriteAnnotations={canWriteAnnotations}
            daemonAvailable={daemonAvailable}
            variant="rail"
          />
        </ToolbarOptionRail>

        <div className="plannotator-review-document">
          <PlanViewer
            plan={plan}
            onEdit={onEdit}
            onChartWideChange={onChartWideChange}
            onToggleChart={onToggleChart}
            onHistory={isPro ? onHistory : undefined}
            onShare={isPro ? onShare : undefined}
            actionToolbarExtra={actionToolbarExtra}
            headerExtra={<PlanHeaderExtra plan={plan} isPro={isPro} mode={mode} />}
            outlineHidden={outlineHidden}
            chartHidden={chartHidden}
            annotations={annotationState.annotations}
            selectedAnnotationId={annotationState.selectedAnnotationId}
            canCreateAnnotations={canWriteAnnotations}
            annotationUpgradeMessage={annotationUpgradeMessage}
            annotationCreateError={annotationState.createError}
            onCreateAnnotation={annotationState.createAnnotation}
            onClearAnnotationCreateError={annotationState.clearCreateError}
            onSelectAnnotation={annotationState.setSelectedAnnotationId}
          />
        </div>

        <ToolbarOptionRail
          side="right"
          active={hasRightRail}
          onExitComplete={handleRightRailExitComplete}
        >
          <AnimatePresence initial={false}>
            {showPlannotatorTools && (
              <ToolbarOptionSurface key="writeback" placement="right">
                <CloudPlannotatorWritebackPanel
                  plan={plan}
                  canQueueWriteback={canWriteAnnotations}
                  daemonAvailable={daemonAvailable}
                  variant="rail"
                />
              </ToolbarOptionSurface>
            )}
            {showComments && (
              <ToolbarOptionSurface key="comments" placement="right">
                <CommentThread planId={plan.id} isOwner className="plannotator-comments-panel" />
              </ToolbarOptionSurface>
            )}
          </AnimatePresence>
        </ToolbarOptionRail>
      </m.div>
    </LazyMotion>
  );
}

function CloudPlanActionExtras({
  showPlannotatorTools,
  showComments,
  isCloudReview,
  onTogglePlannotatorTools,
  onToggleComments,
}: {
  showPlannotatorTools: boolean;
  showComments: boolean;
  isCloudReview: boolean;
  onTogglePlannotatorTools: () => void;
  onToggleComments: () => void;
}) {
  return (
    <>
      {isCloudReview && (
        <>
          <PlanActionButton
            label={showPlannotatorTools ? 'Hide Plannotator tools' : 'Show Plannotator tools'}
            tooltip={showPlannotatorTools ? 'Hide Plannotator tools' : 'Show Plannotator tools'}
            pressed={showPlannotatorTools}
            onClick={onTogglePlannotatorTools}
          >
            <PlannotatorToolbarIcon />
          </PlanActionButton>
          <PlanActionButton
            label={showComments ? 'Hide comments' : 'Show comments'}
            tooltip={showComments ? 'Hide comments' : 'Show comments'}
            pressed={showComments}
            onClick={onToggleComments}
          >
            <CommentPanelIcon />
          </PlanActionButton>
        </>
      )}
    </>
  );
}

function PlannotatorToolbarIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.65}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.25 3.75h7l4.5 4.5v10a2 2 0 0 1-2 2H6.25a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.25 3.95v4.3h4.3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 15.4l2.8-2.8 2.1 2.1 3.2-3.2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 8.4h2.6M8 8.4V11" />
      <circle cx="8" cy="15.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="16.1" cy="11.5" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CommentPanelIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9M7.5 12h6.75M4.5 4.5h15v10.5a2.25 2.25 0 0 1-2.25 2.25H9L4.5 20.25V4.5Z"
      />
    </svg>
  );
}

function DashboardMain({
  mode,
  isPro,
  isWorkspaceAccessLoading,
  backendStatus,
  cloudSyncPaused,
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
  cloudSyncPaused: boolean;
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
  const [showPlannotatorTools, setShowPlannotatorTools] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const selectedAnnotationState = useCloudPlanAnnotations({
    plan: selectedPlan,
    enabled: mode === 'cloud' && isPro && Boolean(selectedPlan),
  });
  const splitAnnotationState = useCloudPlanAnnotations({
    plan: splitPlan,
    enabled: mode === 'cloud' && isPro && Boolean(splitPlan),
  });
  const { user } = useAuth();
  const currentUserId = user?.id ? String(user.id) : undefined;
  const canWriteSelectedAnnotations =
    mode === 'cloud' && isPro && Boolean(currentUserId) && selectedPlan?.ownerId === currentUserId;
  const canWriteSplitAnnotations =
    mode === 'cloud' && isPro && Boolean(currentUserId) && splitPlan?.ownerId === currentUserId;
  const selectedAnnotationUnavailableMessage =
    mode === 'cloud' && selectedPlan && !canWriteSelectedAnnotations
      ? isPro
        ? 'Only the plan owner can create inline annotations.'
        : 'Inline plan annotations are available on Cloud Pro.'
      : undefined;
  const splitAnnotationUnavailableMessage =
    mode === 'cloud' && splitPlan && !canWriteSplitAnnotations
      ? isPro
        ? 'Only the plan owner can create inline annotations.'
        : 'Inline plan annotations are available on Cloud Pro.'
      : undefined;
  const isCloudReview = mode === 'cloud' && isPro;
  const actionToolbarExtra = (
    <CloudPlanActionExtras
      showPlannotatorTools={showPlannotatorTools}
      showComments={showComments}
      isCloudReview={isCloudReview}
      onTogglePlannotatorTools={() => setShowPlannotatorTools((current) => !current)}
      onToggleComments={() => setShowComments((current) => !current)}
    />
  );

  useEffect(() => {
    if (selectedAnnotationState.selectedAnnotationId || splitAnnotationState.selectedAnnotationId) {
      setShowPlannotatorTools(true);
    }
  }, [selectedAnnotationState.selectedAnnotationId, splitAnnotationState.selectedAnnotationId]);

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
          {cloudSyncPaused && <CloudSyncPausedBadge />}
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
            actionToolbarExtra={actionToolbarExtra}
            headerExtra={<PlanHeaderExtra plan={selectedPlan} isPro={isPro} mode={mode} />}
            chartHidden={chartHidden}
            annotations={selectedAnnotationState.annotations}
            selectedAnnotationId={selectedAnnotationState.selectedAnnotationId}
            canCreateAnnotations={canWriteSelectedAnnotations}
            annotationUpgradeMessage={selectedAnnotationUnavailableMessage}
            annotationCreateError={selectedAnnotationState.createError}
            onCreateAnnotation={selectedAnnotationState.createAnnotation}
            onClearAnnotationCreateError={selectedAnnotationState.clearCreateError}
            onSelectAnnotation={selectedAnnotationState.setSelectedAnnotationId}
          />
          {isCloudReview && (
            <CloudToolbarOptionStack
              plan={selectedPlan}
              annotationState={selectedAnnotationState}
              canWriteAnnotations={canWriteSelectedAnnotations}
              daemonAvailable={!cloudSyncPaused}
              showPlannotatorTools={showPlannotatorTools}
              showComments={showComments}
            />
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
            actionToolbarExtra={actionToolbarExtra}
            headerExtra={<PlanHeaderExtra plan={splitPlan} isPro={isPro} mode={mode} />}
            chartHidden={chartHidden}
            annotations={splitAnnotationState.annotations}
            selectedAnnotationId={splitAnnotationState.selectedAnnotationId}
            canCreateAnnotations={canWriteSplitAnnotations}
            annotationUpgradeMessage={splitAnnotationUnavailableMessage}
            annotationCreateError={splitAnnotationState.createError}
            onCreateAnnotation={splitAnnotationState.createAnnotation}
            onClearAnnotationCreateError={splitAnnotationState.clearCreateError}
            onSelectAnnotation={splitAnnotationState.setSelectedAnnotationId}
          />
          {isCloudReview && (
            <CloudToolbarOptionStack
              plan={splitPlan}
              annotationState={splitAnnotationState}
              canWriteAnnotations={canWriteSplitAnnotations}
              daemonAvailable={!cloudSyncPaused}
              showPlannotatorTools={showPlannotatorTools}
              showComments={showComments}
            />
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
      {mode === 'cloud' && cloudSyncPaused && backendStatus !== 'offline' && (
        <CloudSyncPausedNotice />
      )}
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
            {isPro && mode === 'cloud' ? (
              <CloudPlanReviewWorkspace
                plan={selectedPlan}
                mode={mode}
                isPro={isPro}
                annotationState={selectedAnnotationState}
                canWriteAnnotations={canWriteSelectedAnnotations}
                annotationUpgradeMessage={selectedAnnotationUnavailableMessage}
                daemonAvailable={!cloudSyncPaused}
                showPlannotatorTools={showPlannotatorTools}
                showComments={showComments}
                actionToolbarExtra={actionToolbarExtra}
                outlineHidden={outlineHidden}
                chartHidden={chartHidden}
                onEdit={onEdit}
                onHistory={onHistory}
                onShare={onShare}
                onChartWideChange={onChartWideChange}
                onToggleChart={onToggleChart}
              />
            ) : (
              <PlanViewer
                plan={selectedPlan}
                onEdit={onEdit}
                onChartWideChange={onChartWideChange}
                onToggleChart={onToggleChart}
                onHistory={isPro ? onHistory : undefined}
                onShare={isPro ? onShare : undefined}
                actionToolbarExtra={actionToolbarExtra}
                headerExtra={<PlanHeaderExtra plan={selectedPlan} isPro={isPro} mode={mode} />}
                outlineHidden={outlineHidden}
                chartHidden={chartHidden}
                annotations={selectedAnnotationState.annotations}
                selectedAnnotationId={selectedAnnotationState.selectedAnnotationId}
                canCreateAnnotations={canWriteSelectedAnnotations}
                annotationUpgradeMessage={selectedAnnotationUnavailableMessage}
                annotationCreateError={selectedAnnotationState.createError}
                onCreateAnnotation={selectedAnnotationState.createAnnotation}
                onClearAnnotationCreateError={selectedAnnotationState.clearCreateError}
                onSelectAnnotation={selectedAnnotationState.setSelectedAnnotationId}
              />
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
  cloudSyncPaused,
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
  cloudSyncPaused: boolean;
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
          <div className="p-4 text-[12.5px] text-tertiary text-center">
            {cloudSyncPaused
              ? 'No synced cloud plans yet. Start the CLI daemon to sync local plans.'
              : 'Syncing plans...'}
          </div>
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
    cloudSyncPaused,
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

  const selectedPlanBase = useMemo(() => {
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

  // Cloud list items ship without `content` (see getMyPublishedPlans); hydrate
  // the selected plan before it fans out to the viewer/editor/share/plannotator
  // consumers below. Plans that already carry content (local mode, optimistic
  // copies from the editor) skip the fetch.
  const cloudSelectedPlanContent = useCloudPlanContent(
    mode === 'cloud' && selectedPlanBase && !selectedPlanBase.content
      ? selectedPlanBase.id
      : null,
  );
  const selectedPlan = useMemo(() => {
    if (!selectedPlanBase) return undefined;
    if (mode !== 'cloud' || selectedPlanBase.content) return selectedPlanBase;
    return { ...selectedPlanBase, content: cloudSelectedPlanContent ?? '' };
  }, [selectedPlanBase, mode, cloudSelectedPlanContent]);

  // Auto-follow a live replacement only for a session that ended *while the user
  // was viewing it* (it got superseded while open). Deliberately opening an
  // ended/superseded plan for review — via the sidebar or a restored URL — must
  // be respected and never redirected away.
  //
  // When a session transitions live -> ended we mark it as "follow eligible" and
  // keep that intent until selection moves to a different plan, so a replacement
  // that only syncs in a later reactive update is still followed.
  const prevPlannotatorLivenessRef = useRef<{ id: string; wasLive: boolean } | null>(null);
  const followFromPlanIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'cloud' || !selectedPlan) {
      prevPlannotatorLivenessRef.current = null;
      followFromPlanIdRef.current = null;
      return;
    }
    const prev = prevPlannotatorLivenessRef.current;
    if (prev && prev.id !== selectedPlan.id) {
      // Selection changed: drop any pending follow intent from the prior plan.
      followFromPlanIdRef.current = null;
    }
    if (prev?.id === selectedPlan.id && prev.wasLive && isEndedPlannotatorSession(selectedPlan)) {
      followFromPlanIdRef.current = selectedPlan.id;
    }
    prevPlannotatorLivenessRef.current = {
      id: selectedPlan.id,
      wasLive: isLivePlannotatorSession(selectedPlan),
    };

    if (followFromPlanIdRef.current !== selectedPlan.id) return;
    const replacement = findLivePlannotatorReplacement(selectedPlan, plans);
    if (!replacement) return;
    followFromPlanIdRef.current = null;
    setSelectedPlanId(replacement.id);
    if (splitPlanId === replacement.id) setSplitPlanId(null);
  }, [mode, selectedPlan, plans, setSelectedPlanId, splitPlanId, setSplitPlanId]);

  const splitPlan = useMemo(() => {
    if (!splitPlanId) return undefined;
    return plansById.get(splitPlanId) ?? plans.find((p) => p.id === splitPlanId);
  }, [plansById, plans, splitPlanId]);

  const isSplitView = !!selectedPlan && !!splitPlan && selectedPlan.id !== splitPlan.id;
  const effectiveChartHidden = !isPro && !isWorkspaceAccessLoading ? false : chartHidden;

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => {
      setActivePanel(null);
      setLocalAutoSelectSuppressed(!plan);
      setOptimisticSelectedPlan(plan);
      setSelectedPlanId(plan?.id ?? null);
      if (!plan || splitPlanId === plan.id) {
        setSplitPlanId(null);
      }
    },
    [setActivePanel, setSelectedPlanId, splitPlanId, setSplitPlanId],
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
      setActivePanel(null);
      if (!selectedPlanId) {
        setSelectedPlanId(plan.id);
        return;
      }
      if (plan.id === selectedPlanId) return;
      setSplitPlanId(plan.id);
    },
    [selectedPlanId, setActivePanel, setSelectedPlanId, setSplitPlanId],
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
    window.dispatchEvent(new Event('agendex:plan-layout-change'));
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
    window.dispatchEvent(new Event('agendex:plan-layout-change'));
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
        onNavigate={(path: string) =>
          startViewTransition(() => {
            setActivePanel(null);
            navigate(path);
          })
        }
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
        actions={
          mode === 'local' ? (
            <button
              type="button"
              onClick={() => setSourcesOpen(true)}
              aria-label="Manage plan sources"
              title="Manage plan sources"
              className="agendex-topbar-button w-[30px] h-[30px] shrink-0 rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center"
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
          ) : undefined
        }
      />

      {mode === 'local' && (
        <PlanSourcesDialog
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          onSourcesChanged={() => refresh()}
        />
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
        cloudSyncPaused={cloudSyncPaused}
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
        cloudSyncPaused={cloudSyncPaused}
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

function DocsRoute() {
  const [, navigate] = useLocation();
  return <DocsPage onBack={() => startViewTransition(() => navigate('/'))} />;
}

function CliAuthRoute() {
  const callback = new URLSearchParams(window.location.search).get('callback');
  if (!callback) return <Redirect to="/" />;
  return <CliAuthPage callbackUrl={callback} />;
}

/**
 * Legacy auth-check route for old marketing links. The root landing page no
 * longer depends on this route before rendering.
 */
function AuthCheckRoute() {
  const { isAuthenticated, isLoading, refreshSession } = useAuth();
  const authSettled = useAuthSessionSettled({ isAuthenticated, isLoading, refreshSession });
  const appUrl = getConfiguredAppUrl();
  const marketingUrl = getConfiguredMarketingUrl(appUrl);
  const returnTo = new URLSearchParams(window.location.search).get('returnTo');

  useEffect(() => {
    if (!authSettled) return;
    if (isAuthenticated) {
      window.location.replace(DASHBOARD_PATH);
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
        dest.searchParams.set('checkedAt', String(Date.now()));
        window.location.replace(dest.toString());
      } catch {
        window.location.replace('/');
      }
    }
  }, [authSettled, isAuthenticated, returnTo, marketingUrl, appUrl]);

  return <BootLoadingView />;
}

function LandingRoute() {
  const [, navigate] = useLocation();

  return (
    <LandingPage
      mascot={{ onActivate: () => startViewTransition(() => navigate('/about-me')) }}
      onShowChangelog={() => startViewTransition(() => navigate('/changelog'))}
      onShowDocs={() => startViewTransition(() => navigate('/docs'))}
    >
      <LandingPage.NavbarAuth>{() => <EENavbarAuth />}</LandingPage.NavbarAuth>
      <LandingPage.HeroCta>{() => <EEHeroCta />}</LandingPage.HeroCta>
      <LandingPage.PricingCta>{() => <EEPricingCta />}</LandingPage.PricingCta>
    </LandingPage>
  );
}

function DashboardRoute() {
  const { isAuthenticated, isLoading, refreshSession } = useAuth();
  const hasCachedToken = hasToken();
  const avatars = useQuery(api.agentAvatars.listMyAgentAvatars, isAuthenticated ? {} : 'skip');
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

  const renderDashboard = (autoMode: DashboardMode) => (
    <AgentAvatarProvider avatars={avatars ?? {}}>
      <Dashboard autoMode={autoMode} />
    </AgentAvatarProvider>
  );

  if (isAuthenticated && onboardingResolved && needsOnboarding) return <Redirect to="/welcome" />;

  if (hasCachedToken) {
    return renderDashboard(isAuthenticated && onboardingResolved ? 'cloud' : 'local');
  }

  if (isAuthenticated) {
    if (!onboardingResolved) return <BootLoadingView />;
    return renderDashboard('cloud');
  }

  if (isLoading || !authSettled || processingOtt) return <BootLoadingView />;

  return <Redirect to="/login" />;
}

function AuthRuntime({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}

export default function App() {
  return (
    <Switch>
      <Route path="/auth/check">
        {() => (
          <AuthRuntime>
            <AuthCheckRoute />
          </AuthRuntime>
        )}
      </Route>
      <Route path="/auth/cli">
        {() => (
          <AuthRuntime>
            <CliAuthRoute />
          </AuthRuntime>
        )}
      </Route>
      <Route path="/login">
        {() => (
          <AuthRuntime>
            <AuthPage mode="login" />
          </AuthRuntime>
        )}
      </Route>
      <Route path="/signup">
        {() => (
          <AuthRuntime>
            <AuthPage mode="signup" />
          </AuthRuntime>
        )}
      </Route>
      <Route path="/shared/:token">
        {({ token }) => (
          <AuthRuntime>
            <SharedPlanView token={token} />
          </AuthRuntime>
        )}
      </Route>
      <Route path="/about-me" component={AboutMePage} />
      <Route path="/changelog" component={ChangelogRoute} />
      <Route path="/docs" component={DocsRoute} />
      <Route path="/welcome">
        <AuthRuntime>
          <OnboardingRoute>
            <WelcomeScreen />
          </OnboardingRoute>
        </AuthRuntime>
      </Route>
      <Route path="/invite/:token">
        {({ token }) => (
          <AuthRuntime>
            <AcceptInvitePage token={token} />
          </AuthRuntime>
        )}
      </Route>
      <Route path="/settings">
        {() => (
          <AuthRuntime>
            <SettingsPage />
          </AuthRuntime>
        )}
      </Route>
      <Route path={DASHBOARD_PATH}>
        {() => (
          <AuthRuntime>
            <DashboardRoute />
          </AuthRuntime>
        )}
      </Route>
      <Route path="/" component={LandingRoute} />
    </Switch>
  );
}
