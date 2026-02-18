import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { hasToken, setToken, type Plan } from './lib/api.ts';
import { usePlans, useAgents } from './hooks/usePlans.ts';
import { SearchBar } from './components/SearchBar.tsx';
import { SidebarFilters } from './components/SidebarFilters.tsx';
import { PlanList } from './components/PlanList.tsx';
import { PlanViewer } from './components/PlanViewer.tsx';
import { useBackendStatus } from './hooks/useBackendStatus.ts';
import { useCloudPlans } from './hooks/useCloudPlans.ts';
import { filterPlans } from './lib/plan-search.ts';
import { LandingPage } from './components/LandingPage.tsx';
import { AuthButton } from './components/AuthButton.tsx';
import { SharedPlanView } from './components/SharedPlanView.tsx';
import { CliAuthPage } from './components/CliAuthPage.tsx';
import { SubscriptionBadge } from './components/SubscriptionBadge.tsx';
import { SkeletonBlock } from './components/Skeleton.tsx';
import { OfflineView } from './components/OfflineView.tsx';
import { useSubscription } from './hooks/useSubscription.ts';
import { PricingModal } from './components/PricingModal.tsx';
import { PaywallGuard } from './components/PaywallGuard.tsx';
import { startViewTransition } from './lib/view-transition.ts';

const PlanEditor = lazy(() =>
  import('./components/PlanEditor.tsx').then((m) => ({ default: m.PlanEditor })),
);

const PlanCreator = lazy(() =>
  import('./components/PlanCreator.tsx').then((m) => ({ default: m.PlanCreator })),
);

const SIDEBAR_EXPANDED_WIDTH = 260;
const SIDEBAR_PREF_KEY = 'agendex_sidebar_hidden';
const SIDEBAR_HOVER_ZONE_WIDTH = 14;
const TOPBAR_HEIGHT = 70;

type DashboardMode = 'local' | 'cloud';

function SidebarToggleIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
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

function Dashboard() {
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<string | undefined>();
  const [selectedPlan, setSelectedPlan] = useState<Plan | undefined>();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [mode, setMode] = useState<DashboardMode>('local');
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === 'true';
  });
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'title'>('updatedAt');
  const [dateBucket, setDateBucket] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const filters = useMemo(() => ({ agent: agentFilter, sort: sortBy }), [agentFilter, sortBy]);

  const localPlans = usePlans(filters);
  const cloudPlans = useCloudPlans();
  const agents = useAgents();
  const backendStatus = useBackendStatus();
  const { isActive: _isPro } = useSubscription();
  const isPro = true; // TODO: remove — temporary override for testing unseen dots

  const { plans, loading, error, refresh } =
    mode === 'cloud'
      ? {
          plans: cloudPlans.plans,
          loading: cloudPlans.loading,
          error: cloudPlans.error,
          refresh: async () => {},
        }
      : localPlans;

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

  useEffect(() => {
    if (backendStatus === 'offline' && mode === 'local') {
      setMode('cloud');
    }
  }, [backendStatus]);

  const totalPlans = useMemo(() => {
    if (mode === 'cloud') return plans.length;
    return agents.reduce((sum, a) => sum + a.planCount, 0);
  }, [agents, plans, mode]);

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

  useEffect(() => {
    if (filteredPlans.length === 0) {
      setSelectedPlan(undefined);
      setEditing(false);
      return;
    }

    setSelectedPlan((current) => {
      if (!current) return filteredPlans[0];
      return filteredPlans.find((plan) => plan.id === current.id) ?? filteredPlans[0];
    });
  }, [filteredPlans]);

  function handleSaved() {
    setEditing(false);
    refresh();
  }

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
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            className="shrink-0"
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
          <span
            className="font-semibold text-sm"
            style={{ letterSpacing: '-0.02em', color: 'var(--text)', whiteSpace: 'nowrap' }}
          >
            Agendex
          </span>
          {mode === 'local' && backendStatus === 'online' && (
            <button
              type="button"
              onClick={() => {
                if (isPro) {
                  startViewTransition(() => {
                    setCreating(true);
                    setEditing(false);
                  });
                } else {
                  setShowPricingModal(true);
                }
              }}
              aria-label="Create new plan"
              title="Create new plan"
              style={{
                marginLeft: '8px',
                width: '28px',
                height: '28px',
                borderRadius: '7px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                style={{ width: '15px', height: '15px' }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="hidden md:flex min-w-0 justify-center">
          <SearchBar
            search={search}
            onSearch={setSearch}
            plans={plans}
            selectedId={selectedPlan?.id}
            onSelectPlan={setSelectedPlan}
            isPro={isPro}
          />
        </div>

        <div
          className="flex items-center justify-end gap-3 min-w-0 justify-self-end"
          style={{ paddingRight: '16px' }}
        >
          <SubscriptionBadge />
          <AuthButton />
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
            <button
              type="button"
              onClick={() => setMode(mode === 'local' ? 'cloud' : 'local')}
              style={{
                fontSize: '11px',
                fontWeight: 550,
                padding: '2px 8px',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--secondary)',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {mode}
            </button>
          </div>
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
          {mode === 'local' && backendStatus === 'online' && (
            <button
              type="button"
              onClick={() => {
                if (isPro) {
                  startViewTransition(() => {
                    setCreating(true);
                    setEditing(false);
                  });
                } else {
                  setShowPricingModal(true);
                }
              }}
              style={{
                width: '100%',
                padding: '6px 10px',
                marginBottom: '8px',
                fontSize: '12.5px',
                fontWeight: 550,
                fontFamily: 'inherit',
                borderRadius: '7px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
              }}
            >
              <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span> New
            </button>
          )}
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
              isPro={isPro}
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
        {creating ? (
          <Suspense
            fallback={
              <div className="p-4">
                <SkeletonBlock lines={5} />
              </div>
            }
          >
            <PaywallGuard onBack={() => startViewTransition(() => setCreating(false))}>
              <PlanCreator
                agents={agents}
                onClose={() => startViewTransition(() => setCreating(false))}
                onCreated={(plan) => {
                  startViewTransition(() => {
                    setCreating(false);
                    refresh();
                    setSelectedPlan(plan);
                  });
                }}
              />
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
              <PlanEditor
                plan={selectedPlan}
                onClose={() => startViewTransition(() => setEditing(false))}
                onSaved={handleSaved}
              />
            </Suspense>
          ) : (
            <PlanViewer
              plan={selectedPlan}
              onEdit={() => startViewTransition(() => setEditing(true))}
            />
          )
        ) : backendStatus === 'offline' ? (
          <OfflineView />
        ) : (
          <div
            className="h-full flex items-center justify-center"
            style={{ fontSize: '13px', color: 'var(--tertiary)' }}
          >
            Select a plan to view
          </div>
        )}
      </div>

      {showPricingModal && <PricingModal onClose={() => setShowPricingModal(false)} />}
    </div>
  );
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return path;
}

/**
 * Main entry point of the application.
 */
export default function App() {
  const path = useRoute();

  if (path === '/auth/cli') {
    const params = new URLSearchParams(window.location.search);
    const callback = params.get('callback');

    if (callback) return <CliAuthPage callbackUrl={callback} />;
  }

  const sharedMatch = path.match(/^\/shared\/([^/]+)/);
  if (sharedMatch) {
    return <SharedPlanView token={sharedMatch[1]!} />;
  }

  if (!hasToken()) return <LandingPage />;

  return <Dashboard />;
}
