import { parseAsString, parseAsStringLiteral, throttle, useQueryState, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyStateView } from './components/EmptyStateView.tsx';
import { LandingPage } from '@agendex/web';
import { OfflineView } from './components/OfflineView.tsx';
import { PlanViewer } from './components/PlanViewer.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Topbar } from './components/Topbar.tsx';
import { useBackendStatus } from './hooks/useBackendStatus.ts';
import { useAgents, usePlans } from './hooks/usePlans.ts';
import { api, hasToken, type Plan } from './lib/api.ts';
import { SIDEBAR_EXPANDED_WIDTH } from './lib/constants.ts';
import { filterPlans } from './lib/plan-search.ts';

const SIDEBAR_PREF_KEY = 'agendex_sidebar_hidden';
const SIDEBAR_HOVER_ZONE_WIDTH = 14;
const TOPBAR_HEIGHT = 70;

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
    if (filteredPlans.length === 0 || !selectedPlanId) return undefined;
    return filteredPlans.find((p) => p.id === selectedPlanId) ?? undefined;
  }, [filteredPlans, selectedPlanId]);

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => setSelectedPlanId(plan?.id ?? null),
    [setSelectedPlanId],
  );

  useEffect(() => {
    if (!selectedPlanId) return;
    if (filteredPlans.length === 0 || !filteredPlans.find((p) => p.id === selectedPlanId)) {
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
      className="h-screen grid overflow-clip"
      style={{
        position: 'relative',
        gridTemplateColumns: `${sidebarWidth}px 1fr`,
        gridTemplateRows: `${TOPBAR_HEIGHT}px 1fr`,
        transition: 'grid-template-columns 180ms ease',
      }}
    >
      <Topbar
        sidebarHidden={sidebarHidden}
        sidebarPinnedOpen={sidebarPinnedOpen}
        onToggleSidebar={toggleSidebar}
        search={search}
        onSearch={setSearch}
        plans={plans}
        selectedPlan={selectedPlan}
        onSelectPlan={setSelectedPlan}
        totalPlans={totalPlans}
        activeAgents={activeAgents}
        backendStatus={backendStatus}
        height={TOPBAR_HEIGHT}
      />

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

      <Sidebar
        sidebarHidden={sidebarHidden}
        sidebarVisible={sidebarVisible}
        sidebarPeekOpen={sidebarPeekOpen}
        onMouseEnter={revealSidebarOnHover}
        onMouseLeave={schedulePeekClose}
        sortBy={sortBy}
        onSortChange={setSortBy}
        dateBucket={dateBucket}
        onDateBucketChange={setDateBucket}
        agents={agents}
        selectedAgent={agentFilter}
        onAgentSelect={setAgentFilter}
        filteredPlans={filteredPlans}
        selectedPlanId={selectedPlan?.id}
        onSelectPlan={setSelectedPlan}
        loading={loading}
        error={error}
      />

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
          <EmptyStateView
            onSearch={() => {
              window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
              );
            }}
            onRescan={async () => {
              try {
                await api.rescan();
                await refresh();
              } catch (err) {
                console.error('Rescan failed:', err);
              }
            }}
            planCount={totalPlans}
            agents={agents}
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  if (!hasToken()) return <LandingPage />;

  return <Dashboard />;
}
