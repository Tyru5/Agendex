import {
  ChangelogPage,
  DocsPage,
  DownloadPage,
  EmptyStateView,
  applyPlanFilters,
  focusPlanSearchField,
  getAppShortcuts,
  hasToken,
  LandingPage,
  normalizeFilterValues,
  OfflineView,
  type Plan,
  PlanCompareView,
  PlanFilterMismatchBanner,
  PlanSourcesDialog,
  PlanViewer,
  setToken,
  Sidebar,
  startViewTransition,
  ToolsUsedPage,
  Topbar,
  useAgents,
  useBackendStatus,
  useCustomPlanSources,
  usePlans,
  useSidebarWidth,
  workspacesFromPlans,
} from '@agendex/web';
import { useHotkey } from '@tanstack/react-hotkeys';
import {
  parseAsNativeArrayOf,
  parseAsString,
  parseAsStringLiteral,
  throttle,
  useQueryState,
  useQueryStates,
} from 'nuqs';
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
  const [
    {
      agent: legacyAgentFilterRaw,
      agents: agentsFilterRaw,
      sort: sortBy,
      date: dateBucket,
      workspace: workspaceFilterRaw,
    },
    setFilters,
  ] = useQueryStates(
    {
      agent: parseAsString,
      agents: parseAsNativeArrayOf(parseAsString).withDefault([]),
      sort: parseAsStringLiteral(sortOptions).withDefault('updatedAt'),
      date: parseAsStringLiteral(dateOptions).withDefault('all'),
      workspace: parseAsString,
    },
    { clearOnDefault: true },
  );
  const [selectedPlanId, setSelectedPlanId] = useQueryState(
    'plan',
    parseAsString.withOptions({ history: 'push', clearOnDefault: true }),
  );
  const [comparePlanId, setComparePlanId] = useQueryState(
    'compare',
    parseAsString.withOptions({ history: 'push', clearOnDefault: true }),
  );
  const legacyAgentFilter = legacyAgentFilterRaw ?? undefined;
  const workspaceFilter = workspaceFilterRaw ?? undefined;
  const selectedAgents = useMemo(() => {
    if (agentsFilterRaw.length > 0) return normalizeFilterValues(agentsFilterRaw);
    return legacyAgentFilter ? normalizeFilterValues([legacyAgentFilter]) : [];
  }, [agentsFilterRaw, legacyAgentFilter]);
  const setSelectedAgents = useCallback(
    (agents: string[]) => setFilters({ agents: normalizeFilterValues(agents), agent: null }),
    [setFilters],
  );
  const setWorkspaceFilter = useCallback(
    (workspace: string | undefined) => setFilters({ workspace: workspace ?? null }),
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
  const clearFilters = useCallback(() => {
    setSearch('');
    setFilters({ agents: [], agent: null, workspace: null, date: 'all', sort: 'updatedAt' });
  }, [setFilters, setSearch]);

  const [sourcesOpen, setSourcesOpen] = useState(false);

  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === 'true';
  });
  const [outlineHidden, setOutlineHidden] = useState(() => {
    return localStorage.getItem(OUTLINE_PREF_KEY) === 'true';
  });
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const filters = useMemo(() => ({ sort: sortBy }), [sortBy]);

  const localPlans = usePlans(filters, true, false);
  const agents = useAgents(true, false);
  const backendStatus = useBackendStatus();

  const { plans, loading, error, refresh } = localPlans;
  const workspaces = useMemo(() => workspacesFromPlans(plans), [plans]);
  const { customPlanDirs, removeCustomDir, refreshCustomPlanDirs } =
    useCustomPlanSources(IS_LOCAL_WORKSPACE_SHELL);

  const handleRemoveCustomDir = useCallback(
    async (dir: string) => {
      await removeCustomDir(dir);
      await refresh();
    },
    [refresh, removeCustomDir],
  );
  const handleSourcesChanged = useCallback(() => {
    refreshCustomPlanDirs();
    void refresh();
  }, [refresh, refreshCustomPlanDirs]);

  const filteredPlans = useMemo(() => {
    return applyPlanFilters(plans, {
      q: search,
      agents: selectedAgents,
      workspace: workspaceFilter,
      date: dateBucket,
    });
  }, [dateBucket, plans, search, selectedAgents, workspaceFilter]);
  const filteredPlanIds = useMemo(
    () => new Set(filteredPlans.map((plan) => plan.id)),
    [filteredPlans],
  );

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
  const comparePlan = useMemo(() => {
    if (!comparePlanId) return undefined;
    return plansById.get(comparePlanId);
  }, [plansById, comparePlanId]);
  const filterMismatchKey = useMemo(() => {
    if (!selectedPlan) return '';
    return [
      selectedPlan.id,
      search.trim(),
      selectedAgents.join(','),
      workspaceFilter ?? '',
      dateBucket,
    ].join('|');
  }, [dateBucket, search, selectedAgents, selectedPlan, workspaceFilter]);
  const [dismissedFilterMismatchKey, setDismissedFilterMismatchKey] = useState<string | null>(null);
  const selectedPlanOutsideFilters = Boolean(selectedPlan && !filteredPlanIds.has(selectedPlan.id));
  const showFilterMismatchBanner =
    selectedPlanOutsideFilters && dismissedFilterMismatchKey !== filterMismatchKey;

  const setSelectedPlan = useCallback(
    (plan: Plan | undefined) => {
      setSelectedPlanId(plan?.id ?? null);
      setComparePlanId(null);
    },
    [setComparePlanId, setSelectedPlanId],
  );

  const startCompare = useCallback(
    (plan: Plan) => {
      setComparePlanId(plan.id);
    },
    [setComparePlanId],
  );

  const swapCompare = useCallback(() => {
    if (!selectedPlan || !comparePlan) return;
    setSelectedPlanId(comparePlan.id);
    setComparePlanId(selectedPlan.id);
  }, [comparePlan, selectedPlan, setComparePlanId, setSelectedPlanId]);

  useEffect(() => {
    if (selectedPlanId && !plansById.has(selectedPlanId)) {
      setSelectedPlanId(null);
    }
  }, [selectedPlanId, plansById, setSelectedPlanId]);

  useEffect(() => {
    if (comparePlanId && plans.length > 0 && !plansById.has(comparePlanId)) {
      setComparePlanId(null);
    }
  }, [comparePlanId, plans.length, plansById, setComparePlanId]);

  const clearHoverCloseTimer = useCallback(() => {
    if (!hoverCloseTimer.current) return;
    clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = undefined;
  }, []);

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

  const revealSidebarForSearch = useCallback(() => {
    clearHoverCloseTimer();
    setSidebarPeek(false);
    setSidebarHidden(false);
  }, [clearHoverCloseTimer]);

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
        onSelectPlan={setSelectedPlan}
        onFocusSearch={revealSidebarForSearch}
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
          onSourcesChanged={handleSourcesChanged}
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
        search={search}
        onSearch={setSearch}
        sortBy={sortBy}
        onSortChange={setSortBy}
        dateBucket={dateBucket}
        onDateBucketChange={setDateBucket}
        agents={agents}
        selectedAgents={selectedAgents}
        onAgentsChange={setSelectedAgents}
        workspace={workspaceFilter}
        onWorkspaceChange={setWorkspaceFilter}
        workspaces={workspaces}
        onClearFilters={clearFilters}
        onSearchFocusRequest={revealSidebarForSearch}
        filteredPlans={filteredPlans}
        selectedPlanId={selectedPlan?.id}
        onSelectPlan={setSelectedPlan}
        onRemoveCustomDir={IS_LOCAL_WORKSPACE_SHELL ? handleRemoveCustomDir : undefined}
        customPlanDirs={IS_LOCAL_WORKSPACE_SHELL ? customPlanDirs : undefined}
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
        ) : selectedPlan && comparePlan ? (
          <div className="overflow-auto main-scroll" style={{ height: '100%' }}>
            <PlanCompareView
              basePlan={comparePlan}
              targetPlan={selectedPlan}
              onClose={() => setComparePlanId(null)}
              onSwap={swapCompare}
              onOpenPlan={setSelectedPlan}
            />
          </div>
        ) : selectedPlan ? (
          <div className="overflow-auto main-scroll" style={{ height: '100%' }}>
            <PlanViewer
              plan={selectedPlan}
              allPlans={plans}
              onSelectRelatedPlan={setSelectedPlan}
              onComparePlan={startCompare}
              outlineHidden={outlineHidden}
              headerExtra={
                showFilterMismatchBanner ? (
                  <PlanFilterMismatchBanner
                    onShowInFilters={clearFilters}
                    onKeepViewing={() => setDismissedFilterMismatchKey(filterMismatchKey)}
                  />
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-auto main-scroll" style={{ height: '100%' }}>
            <EmptyStateView
              onSearch={() => {
                revealSidebarForSearch();
                focusPlanSearchField();
              }}
              planCount={totalPlans}
              agents={agents}
              plans={plans}
              onSelectPlan={setSelectedPlan}
              shortcuts={getAppShortcuts()}
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

  // Accept a one-time token from the URL fragment (e.g. /#token=abc) so setup
  // links can connect without pasting. Fragments never reach the server; the
  // hash is stripped immediately so the token doesn't linger in the URL.
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#token=')) {
    const token = window.location.hash.slice('#token='.length).trim();
    if (token) setToken(token);
    history.replaceState(null, '', window.location.pathname + window.location.search);
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
