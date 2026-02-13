import { useEffect, useMemo, useRef, useState } from 'react';
import { hasToken, setToken, type Plan } from './lib/api.ts';
import { usePlans, useAgents } from './hooks/usePlans.ts';
import { SearchBar } from './components/SearchBar.tsx';
import { AgentSelect } from './components/AgentSelect.tsx';
import { PlanList } from './components/PlanList.tsx';
import { PlanViewer } from './components/PlanViewer.tsx';
import { PlanEditor } from './components/PlanEditor.tsx';
import { useBackendStatus } from './hooks/useBackendStatus.ts';
import { filterPlans } from './lib/plan-search.ts';
import { LandingPage } from './components/LandingPage.tsx';
import { AuthButton } from './components/AuthButton.tsx';
import { SharedPlanView } from './components/SharedPlanView.tsx';

const SIDEBAR_EXPANDED_WIDTH = 260;
const SIDEBAR_PREF_KEY = 'agendex_sidebar_hidden';
const SIDEBAR_HOVER_ZONE_WIDTH = 14;
const TOPBAR_HEIGHT = 70;

function Login() {
  const [token, setTokenValue] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <form onSubmit={submit} className="w-72 space-y-3">
        <h1
          className="text-center font-semibold tracking-tight"
          style={{ fontSize: '14px', color: 'var(--text)' }}
        >
          Agendex
        </h1>
        <p className="text-center" style={{ fontSize: '12.5px', color: 'var(--tertiary)' }}>
          Enter your auth token
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="Token"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: '13px',
          }}
          autoFocus
        />
        <button
          type="submit"
          className="w-full px-3 py-2 text-sm rounded-lg font-medium transition-colors"
          style={{
            background: 'var(--text)',
            color: 'var(--bg)',
            fontSize: '13px',
          }}
        >
          Connect
        </button>
      </form>
    </div>
  );
}

function Dashboard() {
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<string | undefined>();
  const [selectedPlan, setSelectedPlan] = useState<Plan | undefined>();
  const [editing, setEditing] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === 'true';
  });
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout>>();

  const filters = useMemo(() => ({ agent: agentFilter }), [agentFilter]);

  const { plans, loading, error, refresh } = usePlans(filters);
  const agents = useAgents();
  const backendStatus = useBackendStatus();
  const filteredPlans = useMemo(() => filterPlans(plans, search), [plans, search]);

  const totalPlans = useMemo(() => agents.reduce((sum, a) => sum + a.planCount, 0), [agents]);

  const activeAgents = useMemo(() => agents.filter((a) => a.planCount > 0).length, [agents]);
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
          <div
            className="hidden md:block"
            style={{ width: '1px', height: '18px', background: 'var(--border)' }}
          />
          <div className="hidden md:flex min-w-0 flex-1">
            <SearchBar
              search={search}
              onSearch={setSearch}
              plans={plans}
              selectedId={selectedPlan?.id}
              onSelectPlan={setSelectedPlan}
            />
          </div>
        </div>

        <div className="flex justify-center min-w-0 shrink-0 justify-self-center">
          <AgentSelect agents={agents} selected={agentFilter} onSelect={setAgentFilter} />
        </div>

        <div
          className="flex items-center justify-end gap-3 min-w-0 justify-self-end"
          style={{ paddingRight: '16px' }}
        >
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
            <div
              className="rounded-full"
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
          willChange: sidebarHidden ? 'transform, opacity' : undefined,
          pointerEvents: sidebarVisible ? 'auto' : 'none',
          boxShadow: sidebarPeekOpen ? '0 18px 40px rgba(0,0,0,0.20)' : 'none',
          transition: sidebarHidden
            ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease'
            : 'opacity 120ms ease',
        }}
      >
        <div className="px-3 pt-3">
          <div
            style={{
              fontSize: '11px',
              fontWeight: 550,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--tertiary)',
              padding: '0 8px',
              marginBottom: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            Recent
          </div>
        </div>

        <div className="flex-1 overflow-auto sidebar-scroll px-3 pb-3">
          {loading ? (
            <div className="p-4" style={{ fontSize: '13px', color: 'var(--tertiary)' }}>
              Loading...
            </div>
          ) : error ? (
            <div className="p-4" style={{ fontSize: '13px', color: '#ef4444' }}>
              Failed to load plans.
            </div>
          ) : (
            <PlanList
              plans={filteredPlans}
              selectedId={selectedPlan?.id}
              onSelect={setSelectedPlan}
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
        }}
      >
        {selectedPlan ? (
          editing ? (
            <PlanEditor
              plan={selectedPlan}
              onClose={() => setEditing(false)}
              onSaved={handleSaved}
            />
          ) : (
            <PlanViewer plan={selectedPlan} onEdit={() => setEditing(true)} />
          )
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

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return path;
}

export default function App() {
  const path = useRoute();

  const sharedMatch = path.match(/^\/shared\/([^/]+)/);
  if (sharedMatch) {
    return <SharedPlanView token={sharedMatch[1]!} />;
  }

  if (!hasToken()) return <LandingPage />;
  return <Dashboard />;
}

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
