import {
  ChangelogPage,
  DocsPage,
  DownloadPage,
  EmptyStateView,
  filterPlans,
  hasToken,
  LandingPage,
  OfflineView,
  type Plan,
  PlanSourcesDialog,
  PlanViewer,
  Sidebar,
  startViewTransition,
  ToolsUsedPage,
  Topbar,
  useAgents,
  useBackendStatus,
  usePlans,
  useSidebarWidth,
} from '@agendex/web';
import { useHotkey } from '@tanstack/react-hotkeys';
import { parseAsString, parseAsStringLiteral, throttle, useQueryState, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SIDEBAR_PREF_KEY = 'agendex_sidebar_hidden';
const OUTLINE_PREF_KEY = 'agendex_outline_hidden';
const SIDEBAR_HOVER_ZONE_WIDTH = 14;
const TOPBAR_HEIGHT = 70;

/** Standalone shell is local-workspace only; mirrors `mode === 'local'` in packages/ee. */
const IS_LOCAL_WORKSPACE_SHELL = true;

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

  const [sourcesOpen, setSourcesOpen] = useState(false);

  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === 'true';
  });
  const [outlineHidden, setOutlineHidden] = useState(() => {
    return localStorage.getItem(OUTLINE_PREF_KEY) === 'true';
  });
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const filters = useMemo(() => ({ agent: agentFilter, sort: sortBy }), [agentFilter, sortBy]);

  const localPlans = usePlans(filters, true, false);
  const agents = useAgents(true, false);
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
      refresh();
    }
    prevBackendStatus.current = backendStatus;
  }, [backendStatus, refresh]);

  const totalPlans = useMemo(() => {
    return agents.reduce((sum, a) => sum + a.planCount, 0);
  }, [agents]);

  const activeAgents = agents.filter((a) => a.planCount > 0).length;

  const [expandedWidth, setExpandedWidth] = useSidebarWidth();

  const sidebarPinnedOpen = !sidebarHidden;
  const sidebarPeekOpen = sidebarHidden && sidebarPeek;
  const sidebarVisible = sidebarPinnedOpen || sidebarPeekOpen;
  const sidebarWidth = sidebarPinnedOpen ? expandedWidth : 0;

  useEffect(() => {
    localStorage.setItem(SIDEBAR_PREF_KEY, sidebarHidden ? 'true' : 'false');
  }, [sidebarHidden]);

  useEffect(() => {
    localStorage.setItem(OUTLINE_PREF_KEY, outlineHidden ? 'true' : 'false');
  }, [outlineHidden]);

  useEffect(() => {
    if (!sidebarHidden) setSidebarPeek(false);
  }, [sidebarHidden]);

  useEffect(() => {
    return () => {
      if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    };
  }, []);

  const plansById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const selectedPlan = useMemo(() => {
    if (!selectedPlanId) return undefined;
    return plansById.get(selectedPlanId);
  }, [plansById, selectedPlanId]);

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => {
      setSelectedPlanId(plan?.id ?? null);
    },
    [setSelectedPlanId],
  );

  useEffect(() => {
    if (selectedPlanId && !plansById.has(selectedPlanId)) {
      setSelectedPlanId(null);
    }
  }, [selectedPlanId, plansById, setSelectedPlanId]);

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

  function toggleOutline() {
    setOutlineHidden((current) => !current);
  }

  useHotkey('Mod+B', toggleSidebar);
  useHotkey('Mod+Shift+O', toggleOutline);

  return (
    <div
      className="agendex-app-shell h-screen grid overflow-clip"
      data-plan-open={selectedPlan ? 'true' : undefined}
      style={{
        position: 'relative',
        gridTemplateColumns: `${sidebarWidth}px 1fr`,
        gridTemplateRows: `${TOPBAR_HEIGHT}px 1fr`,
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
        sidebarWidth={expandedWidth}
        actions={
          IS_LOCAL_WORKSPACE_SHELL ? (
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

      {IS_LOCAL_WORKSPACE_SHELL && (
        <PlanSourcesDialog
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          onSourcesChanged={() => localPlans.refresh()}
        />
      )}

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
        width={expandedWidth}
        onResize={setExpandedWidth}
      />

      <div
        className="agendex-main-pane"
        style={{
          gridColumn: '2 / 3',
          gridRow: '2 / 3',
          background: 'transparent',
          viewTransitionName: 'main-content',
          overflow: 'hidden',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {backendStatus === 'offline' ? (
          <OfflineView />
        ) : selectedPlan ? (
          <div className="overflow-auto main-scroll" style={{ height: '100%' }}>
            <PlanViewer plan={selectedPlan} outlineHidden={outlineHidden} />
          </div>
        ) : (
          <div className="overflow-auto main-scroll" style={{ height: '100%' }}>
            <EmptyStateView
              onSearch={() => {
                window.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
                );
              }}
              planCount={totalPlans}
              agents={agents}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SessionExpiredBanner() {
  const [visible, setVisible] = useState(() => {
    const expired = sessionStorage.getItem('agendex_session_expired');
    if (expired) {
      sessionStorage.removeItem('agendex_session_expired');
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="session-expired-banner">
      <span className="session-expired-icon">
        <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
          <path
            d="M8 1.33a6.67 6.67 0 1 0 0 13.34A6.67 6.67 0 0 0 8 1.33ZM8 5v3.33M8 10.67h.007"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>Session expired — please log in again to continue.</span>
      <button className="session-expired-dismiss" onClick={() => setVisible(false)} type="button">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path
            d="M12 4L4 12M4 4l8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

export default function App() {
  if (typeof window !== 'undefined' && window.location.pathname === '/changelog') {
    return (
      <ChangelogPage
        onBack={() => {
          startViewTransition(() => {
            window.location.href = '/';
          });
        }}
      />
    );
  }

  if (typeof window !== 'undefined' && window.location.pathname === '/docs') {
    return (
      <DocsPage
        onBack={() => {
          startViewTransition(() => {
            window.location.href = '/';
          });
        }}
      />
    );
  }

  if (typeof window !== 'undefined' && window.location.pathname === '/download') {
    return (
      <DownloadPage
        onBack={() => {
          startViewTransition(() => {
            window.location.href = '/';
          });
        }}
      />
    );
  }

  if (typeof window !== 'undefined' && window.location.pathname === '/tools') {
    return (
      <ToolsUsedPage
        onBack={() => {
          startViewTransition(() => {
            window.location.href = '/';
          });
        }}
      />
    );
  }

  if (!hasToken()) {
    return (
      <>
        <SessionExpiredBanner />
        <LandingPage
          onShowChangelog={() => {
            startViewTransition(() => {
              window.location.href = '/changelog';
            });
          }}
          onShowDocs={() => {
            startViewTransition(() => {
              window.location.href = '/docs';
            });
          }}
          onShowDownload={() => {
            startViewTransition(() => {
              window.location.href = '/download';
            });
          }}
          onShowTools={() => {
            startViewTransition(() => {
              window.location.href = '/tools';
            });
          }}
        />
      </>
    );
  }

  return <Dashboard />;
}
