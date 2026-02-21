import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from 'nuqs';
import { throttle } from 'nuqs';
import { LandingPage } from './components/LandingPage.tsx';
import { OfflineView } from './components/OfflineView.tsx';

const Design1 = lazy(() => import('./components/landing/Design1.tsx'));
const Design2 = lazy(() => import('./components/landing/Design2.tsx'));
const Design3 = lazy(() => import('./components/landing/Design3.tsx'));
const Design4 = lazy(() => import('./components/landing/Design4.tsx'));
const Design5 = lazy(() => import('./components/landing/Design5.tsx'));
import { PlanList } from './components/PlanList.tsx';
import { PlanViewer } from './components/PlanViewer.tsx';
import { SearchBar } from './components/SearchBar.tsx';
import { SidebarFilters } from './components/SidebarFilters.tsx';
import { SkeletonBlock } from './components/Skeleton.tsx';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { useBackendStatus } from './hooks/useBackendStatus.ts';
import { useAgents, usePlans } from './hooks/usePlans.ts';
import { hasToken, type Plan } from './lib/api.ts';
import { filterPlans } from './lib/plan-search.ts';
import { startViewTransition } from './lib/view-transition.ts';

const SIDEBAR_EXPANDED_WIDTH = 260;
const SIDEBAR_PREF_KEY = 'agendex_sidebar_hidden';
const SIDEBAR_HOVER_ZONE_WIDTH = 14;
const TOPBAR_HEIGHT = 70;

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

const sortOptions = ['updatedAt', 'createdAt', 'title'] as const;
const dateOptions = ['all', 'today', '7d', '30d'] as const;

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

  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === 'true';
  });
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const filters = useMemo(() => ({ agent: agentFilter, sort: sortBy }), [agentFilter, sortBy]);

  const localPlans = usePlans(filters);
  const agents = useAgents();
  const backendStatus = useBackendStatus();

  const { plans, loading, error, refresh } = localPlans;

  const filteredPlans = useMemo(() => {
    let result = filterPlans(plans, search);
    if (dateBucket !== 'all') {
      const cutoffs = { today: 86400000, '7d': 604800000, '30d': 2592000000 };
      const cutoff = Date.now() - cutoffs[dateBucket];
      const field = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
      result = result.filter((p) => new Date(p[field]).getTime() >= cutoff);
    }
    return result;
  }, [plans, search, dateBucket, sortBy]);

  const prevBackendStatus = useRef(backendStatus);
  useEffect(() => {
    if (prevBackendStatus.current === 'offline' && backendStatus === 'online') {
      localPlans.refresh();
    }
    prevBackendStatus.current = backendStatus;
  }, [backendStatus, localPlans.refresh]);

  const totalPlans = useMemo(() => {
    return agents.reduce((sum, a) => sum + a.planCount, 0);
  }, [agents]);

  const activeAgents = agents.filter((a) => a.planCount > 0).length;
  const backendIndicator = useMemo(() => {
    if (backendStatus === 'online') {
      return { label: 'Live', color: '#22c55e' };
    }
    if (backendStatus === 'checking') {
      return { label: 'Checking', color: '#f59e0b' };
    }
    return { label: 'Offline', color: '#ef4444' };
  }, [backendStatus]);

  const sidebarPinnedOpen = !sidebarHidden;
  const sidebarPeekOpen = sidebarHidden && sidebarPeek;
  const sidebarVisible = sidebarPinnedOpen || sidebarPeekOpen;
  const sidebarWidth = sidebarPinnedOpen ? SIDEBAR_EXPANDED_WIDTH : 0;

  useEffect(() => {
    localStorage.setItem(SIDEBAR_PREF_KEY, sidebarHidden ? 'true' : 'false');
  }, [sidebarHidden]);

  useEffect(() => {
    if (!sidebarHidden) setSidebarPeek(false);
  }, [sidebarHidden]);

  useEffect(() => {
    return () => {
      if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    };
  }, []);

  const selectedPlan = useMemo(() => {
    if (filteredPlans.length === 0) return undefined;
    if (selectedPlanId) {
      return filteredPlans.find((p) => p.id === selectedPlanId) ?? filteredPlans[0];
    }
    return filteredPlans[0];
  }, [filteredPlans, selectedPlanId]);

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => setSelectedPlanId(plan?.id ?? null),
    [setSelectedPlanId],
  );

  useEffect(() => {
    if (filteredPlans.length === 0 && selectedPlanId) {
      setSelectedPlanId(null);
    }
  }, [filteredPlans, selectedPlanId, setSelectedPlanId]);

  function clearHoverCloseTimer() {
    if (!hoverCloseTimer.current) return;

    clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = undefined;
  }

  function schedulePeekClose() {
    if (!sidebarHidden) return;

    clearHoverCloseTimer();
    hoverCloseTimer.current = setTimeout(() => {
      setSidebarPeek(false);
    }, 140);
  }

  function revealSidebarOnHover() {
    if (!sidebarHidden) return;
    clearHoverCloseTimer();
    setSidebarPeek(true);
  }

  function toggleSidebar() {
    clearHoverCloseTimer();
    setSidebarPeek(false);
    setSidebarHidden((current) => !current);
  }

  return (
    <div
      className="h-screen grid overflow-hidden"
      style={{
        position: 'relative',
        gridTemplateColumns: `${sidebarWidth}px 1fr`,
        gridTemplateRows: `${TOPBAR_HEIGHT}px 1fr`,
        transition: 'grid-template-columns 180ms ease',
      }}
    >
      {/* Topbar */}
      <div
        className="grid items-center min-w-0"
        style={{
          gridColumn: '1 / -1',
          height: `${TOPBAR_HEIGHT}px`,
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
              onClick={toggleSidebar}
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
            onSearch={setSearch}
            plans={plans}
            selectedId={selectedPlan?.id}
            onSelectPlan={setSelectedPlan}
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
            <strong style={{ color: 'var(--secondary)', fontWeight: 550 }}>{totalPlans}</strong>{' '}
            plans
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

      {sidebarHidden && (
        <div
          onMouseEnter={revealSidebarOnHover}
          onMouseLeave={schedulePeekClose}
          style={{
            position: 'absolute',
            left: 0,
            top: `${TOPBAR_HEIGHT}px`,
            height: `calc(100% - ${TOPBAR_HEIGHT}px)`,
            width: `${SIDEBAR_HOVER_ZONE_WIDTH}px`,
            zIndex: 40,
          }}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover-reveal sidebar container */}
      <div
        className="flex flex-col overflow-hidden"
        onMouseEnter={revealSidebarOnHover}
        onMouseLeave={schedulePeekClose}
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
              ? 'translateX(0)'
              : 'translateX(calc(-100% - 1px))'
            : 'none',
          willChange: sidebarPeek ? 'transform, opacity' : undefined,
          pointerEvents: sidebarVisible ? 'auto' : 'none',
          boxShadow: sidebarPeekOpen ? '0 18px 40px rgba(0,0,0,0.20)' : 'none',
          transition: sidebarHidden
            ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease'
            : 'opacity 120ms ease',
        }}
      >
        <div className="px-3 pt-3 pb-2">
          <SidebarFilters
            sortBy={sortBy}
            onSortChange={setSortBy}
            dateBucket={dateBucket}
            onDateBucketChange={setDateBucket}
            agents={agents}
            selectedAgent={agentFilter}
            onAgentSelect={setAgentFilter}
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
              selectedId={selectedPlan?.id}
              onSelect={(plan) => startViewTransition(() => setSelectedPlan(plan))}
            />
          )}
        </div>
      </div>

      {/* Main */}
      <div
        className="overflow-auto main-scroll"
        style={{
          gridColumn: '2 / 3',
          gridRow: '2 / 3',
          background: 'var(--bg)',
          viewTransitionName: 'main-content',
        }}
      >
        {backendStatus === 'offline' ? (
          <OfflineView />
        ) : selectedPlan ? (
          <PlanViewer plan={selectedPlan} />
        ) : (
          <div
            className="h-full flex items-center justify-center"
            style={{ fontSize: '13px', color: 'var(--tertiary)' }}
          >
            Select a plan to view
          </div>
        )}
      </div>
    </div>
  );
}

const DESIGN_ROUTES: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  '/1': Design1,
  '/2': Design2,
  '/3': Design3,
  '/4': Design4,
  '/5': Design5,
};

export default function App() {
  const DesignVariant = DESIGN_ROUTES[window.location.pathname];
  if (DesignVariant) {
    return (
      <Suspense fallback={null}>
        <DesignVariant />
      </Suspense>
    );
  }

  if (!hasToken()) return <LandingPage />;

  return <Dashboard />;
}
