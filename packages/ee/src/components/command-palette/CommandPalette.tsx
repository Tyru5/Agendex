import {
  AgentIcon,
  filterPlans,
  getAgentLabel,
  type Plan,
  type PlanState,
  usePlanState,
  useTheme,
} from '@agendex/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Command, useCommandItems } from './useCommandItems';

const INITIAL_PLAN_BATCH_SIZE = 100;
const PLAN_BATCH_SIZE = 100;

type PaletteView = 'commands' | 'agents';

interface AgentRow {
  agent: string;
  planCount: number;
  latestUpdatedAt: string;
}

export function CommandPalette({
  search,
  onSearch,
  plans,
  selectedId,
  onSelectPlan,
  isPro,
  mode,
  hideTrigger = false,
  onNewPlan,
  onUpload,
  onHistory,
  onNavigate,
  onShowPricing,
  splitPlanId,
  onOpenInSplitView,
  onCloseSplit,
  planState: planStateProp,
  onToggleOutline,
  onToggleChart,
  onDeletePlan,
}: {
  search: string;
  onSearch: (q: string) => void;
  plans: Plan[];
  selectedId: string | undefined;
  onSelectPlan: (plan: Plan) => void;
  isPro: boolean;
  mode: 'local' | 'cloud';
  hideTrigger?: boolean;
  onNewPlan: () => void;
  onUpload: () => void;
  onHistory: () => void;
  onNavigate: (path: string) => void;
  onShowPricing: () => void;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
  onCloseSplit?: () => void;
  planState?: PlanState;
  onToggleOutline?: () => void;
  onToggleChart?: () => void;
  onDeletePlan?: (planId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visiblePlanCount, setVisiblePlanCount] = useState(INITIAL_PLAN_BATCH_SIZE);
  const [view, setView] = useState<PaletteView>('commands');
  const [focusedAgentIndex, setFocusedAgentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openFrameRef = useRef<ReturnType<typeof requestAnimationFrame>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const localPlanState = usePlanState();
  const planState = planStateProp ?? localPlanState;
  const { resolvedTheme, setTheme } = useTheme();
  const modalExitMs = 220;

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return true;

    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ??
      navigator.platform ??
      '';

    return /Mac|iPhone|iPad/i.test(platform);
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const openModal = useCallback(() => {
    clearCloseTimer();
    if (openFrameRef.current) cancelAnimationFrame(openFrameRef.current);

    setVisiblePlanCount(INITIAL_PLAN_BATCH_SIZE);
    setView('commands');
    setFocusedAgentIndex(0);
    setMounted(true);
    openFrameRef.current = requestAnimationFrame(() => {
      setOpen(true);
    });
  }, [clearCloseTimer]);

  const closeModal = useCallback(() => {
    if (openFrameRef.current) cancelAnimationFrame(openFrameRef.current);
    setOpen(false);
    clearCloseTimer();

    closeTimerRef.current = setTimeout(() => {
      setMounted(false);
      closeTimerRef.current = undefined;
    }, modalExitMs);
  }, [clearCloseTimer]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openModal();
      }
      if (e.key === 'Escape') {
        if (mounted && view === 'agents') {
          e.preventDefault();
          setView('commands');
          setFocusedAgentIndex(0);
        } else {
          closeModal();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeModal, openModal, mounted, view]);

  useEffect(() => {
    if (!open) return;
    const timerId = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timerId);
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [open, view]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (openFrameRef.current) cancelAnimationFrame(openFrameRef.current);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [resolvedTheme, setTheme]);

  const filteredPlans = useMemo(() => filterPlans(plans, search), [plans, search]);

  const agentRows = useMemo<AgentRow[]>(() => {
    const map = new Map<string, AgentRow>();
    for (const plan of plans) {
      const key = plan.agent.trim().toLowerCase();
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.planCount += 1;
        if (new Date(plan.updatedAt).getTime() > new Date(existing.latestUpdatedAt).getTime()) {
          existing.latestUpdatedAt = plan.updatedAt;
        }
      } else {
        map.set(key, {
          agent: plan.agent,
          planCount: 1,
          latestUpdatedAt: plan.updatedAt,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.planCount !== a.planCount) return b.planCount - a.planCount;
      return getAgentLabel(a.agent).localeCompare(getAgentLabel(b.agent));
    });
  }, [plans]);

  const filteredAgentRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agentRows;
    return agentRows.filter(
      (row) =>
        row.agent.toLowerCase().includes(q) || getAgentLabel(row.agent).toLowerCase().includes(q),
    );
  }, [agentRows, search]);

  useEffect(() => {
    if (view !== 'agents') return;
    if (focusedAgentIndex > Math.max(0, filteredAgentRows.length - 1)) {
      setFocusedAgentIndex(0);
    }
  }, [view, filteredAgentRows.length, focusedAgentIndex]);

  const applyAgent = useCallback(
    (agent: string) => {
      onSearch(agent);
      setView('commands');
      setFocusedAgentIndex(0);
    },
    [onSearch],
  );

  const visibleUnseenPlans = useMemo(
    () =>
      filteredPlans.filter(
        (plan) => plan.id !== selectedId && planState.isUnseen(plan.id, plan.updatedAt),
      ),
    [filteredPlans, planState, selectedId],
  );

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    if (splitPlanId && onCloseSplit) {
      cmds.push({
        id: 'close-split',
        label: 'Close Split View',
        group: 'actions',
        icon: <CloseSplitIcon />,
        footerHint: 'Exit split pane view',
        action: onCloseSplit,
      });
    }

    cmds.push({
      id: 'new-plan',
      label: 'New Plan',
      group: 'actions',
      icon: <PlusIcon />,
      footerHint: 'Create a new plan',
      proOnly: mode === 'cloud',
      action: () => {
        if (mode === 'cloud' && !isPro) {
          onShowPricing();
        } else {
          onNewPlan();
        }
      },
    });

    if (onToggleOutline) {
      cmds.push({
        id: 'toggle-outline',
        label: 'Toggle Outline',
        group: 'actions',
        icon: <OutlineIcon />,
        footerHint: 'Show or hide plan outline (⇧⌘O)',
        action: onToggleOutline,
      });
    }

    if (onToggleChart) {
      cmds.push({
        id: 'toggle-chart',
        label: 'Toggle Tech Chart',
        group: 'actions',
        icon: <ChartIcon />,
        footerHint: 'Show or hide tech dependency chart (⇧⌘G)',
        action: onToggleChart,
        proOnly: true,
      });
    }

    cmds.push({
      id: 'manage-history',
      label: 'Manage Plan History',
      group: 'plans',
      icon: <ClockIcon />,
      footerHint: 'View plan version history',
      proOnly: true,
      action: () => {
        if (!isPro) {
          onShowPricing();
        } else {
          onHistory();
        }
      },
    });

    if (visibleUnseenPlans.length > 0) {
      cmds.push({
        id: 'mark-all-read',
        label: 'Mark All as Read',
        group: 'plans',
        icon: <MarkReadIcon />,
        footerHint: `Mark ${visibleUnseenPlans.length} updated plan${visibleUnseenPlans.length === 1 ? '' : 's'} as read`,
        action: () => {
          planState.markAllSeen(visibleUnseenPlans);
        },
      });
    }

    cmds.push({
      id: 'view-agents',
      label: 'View All Agents',
      group: 'plans',
      icon: <BoxIcon />,
      footerHint: 'Browse all sync’d agents creating plans',
      closeOnSelect: false,
      action: () => {
        onSearch('');
        setFocusedAgentIndex(0);
        setView('agents');
      },
    });

    cmds.push({
      id: 'upload-plan',
      label: 'Upload Plan',
      group: 'plans',
      icon: <PaperclipIcon />,
      footerHint: 'Upload a plan file',
      action: onUpload,
    });

    if (onDeletePlan && selectedId) {
      cmds.push({
        id: 'delete-plan',
        label: 'Delete Current Plan',
        group: 'plans',
        icon: <TrashIcon />,
        footerHint: 'Permanently delete the selected plan',
        action: () => {
          if (window.confirm('Delete this plan? This cannot be undone.')) {
            onDeletePlan(selectedId);
          }
        },
      });
    }

    cmds.push({
      id: 'toggle-theme',
      label: 'Toggle Theme',
      group: 'settings',
      icon: resolvedTheme === 'dark' ? <MoonIcon /> : <SunIcon />,
      footerHint: `Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`,
      action: toggleTheme,
    });

    cmds.push({
      id: 'account',
      label: 'Account',
      group: 'settings',
      icon: <UserIcon />,
      footerHint: 'Manage your account',
      action: () => onNavigate('/settings'),
    });

    cmds.push({
      id: 'docs',
      label: 'Documentation',
      group: 'support',
      icon: <BookIcon />,
      footerHint: 'Open documentation',
      action: () => window.open('https://github.com/Tyru5/Agendex/blob/main/README.md', '_blank'),
    });

    cmds.push({
      id: 'report-issue',
      label: 'Report Issue',
      group: 'support',
      icon: <FlagIcon />,
      footerHint: 'Report a bug or issue',
      action: () =>
        window.open(
          'https://github.com/Tyru5/Agendex/issues?q=sort%3Aupdated-desc+is%3Aissue+is%3Aopen',
          '_blank',
        ),
    });

    return cmds;
  }, [
    mode,
    isPro,
    resolvedTheme,
    splitPlanId,
    onCloseSplit,
    onNewPlan,
    onUpload,
    onHistory,
    onNavigate,
    onShowPricing,
    onSearch,
    toggleTheme,
    onToggleOutline,
    onToggleChart,
    onDeletePlan,
    selectedId,
    planState,
    visibleUnseenPlans,
  ]);

  const loadMorePlans = useCallback(() => {
    setVisiblePlanCount((current) => Math.min(current + PLAN_BATCH_SIZE, filteredPlans.length));
  }, [filteredPlans.length]);

  const {
    flatItems,
    focusableItems,
    focusedIndex,
    setFocusedIndex,
    footerHint: commandFooterHint,
    onKeyDown: onCommandKeyDown,
    resetFocus,
    getFocusableIndex,
    executeItem,
    hasMorePlans,
    visiblePlanCount: renderedPlanCount,
    filteredPlansCount,
  } = useCommandItems({
    commands,
    filteredPlans,
    search,
    selectedPlanId: selectedId,
    isPro,
    onClose: closeModal,
    onSelectPlan,
    onOpenInSplitView,
    planLimit: visiblePlanCount,
    onRequestMorePlans: loadMorePlans,
  });

  const handleResultsScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !hasMorePlans || view !== 'commands') return;

    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remaining <= 160) {
      loadMorePlans();
    }
  }, [hasMorePlans, loadMorePlans, view]);

  const onAgentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedAgentIndex((i) => Math.min(i + 1, Math.max(0, filteredAgentRows.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedAgentIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = filteredAgentRows[focusedAgentIndex];
        if (row) applyAgent(row.agent);
      }
    },
    [filteredAgentRows, focusedAgentIndex, applyAgent],
  );

  const onInputKeyDown = view === 'agents' ? onAgentKeyDown : onCommandKeyDown;
  const footerHint =
    view === 'agents'
      ? filteredAgentRows.length > 0
        ? 'Filter plans by this agent · Esc to go back'
        : 'Esc to go back'
      : commandFooterHint;

  useEffect(() => {
    if (!open) return;
    resetFocus();
  }, [open, resetFocus]);

  useEffect(() => {
    if (!hasMorePlans || focusableItems.length === 0) return;
    if (focusedIndex >= focusableItems.length - 1) {
      loadMorePlans();
    }
  }, [focusedIndex, focusableItems.length, hasMorePlans, loadMorePlans]);

  useEffect(() => {
    if (focusedIndex < 0) return;

    const container = scrollRef.current;
    const el = container?.querySelector('[data-focused="true"]') as HTMLElement | null;

    if (!container || !el) return;

    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();

    if (eRect.bottom > cRect.bottom) {
      container.scrollTop += eRect.bottom - cRect.bottom + 8;
    } else if (eRect.top < cRect.top) {
      container.scrollTop -= cRect.top - eRect.top + 8;
    }
  }, [focusedIndex, focusedAgentIndex, view]);

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={openModal}
          className="agendex-topbar-button flex items-center gap-2 rounded-lg py-[5px] px-2 border border-border min-w-0 w-full max-w-[150px] overflow-hidden cursor-pointer"
        >
          <SearchIcon />
          <span className="text-[12px] flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden text-ellipsis">
            Search
          </span>
          <kbd className="font-[inherit] text-[10px] leading-none shrink-0 text-tertiary border border-border rounded-[4px] py-[3px] px-1 bg-hover">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      )}

      {mounted && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center px-4"
          style={{
            background: 'color-mix(in oklch, var(--bg) 72%, transparent)',
            opacity: open ? 1 : 0,
            backdropFilter: open ? 'blur(3px)' : 'blur(0px)',
            transition: 'opacity 220ms ease, backdrop-filter 260ms ease',
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="agendex-popover w-[min(560px,100%)] h-fit rounded-[14px] overflow-hidden flex flex-col"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0px) scale(1)' : 'translateY(-10px) scale(0.98)',
              transition: 'opacity 220ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: open ? 'opacity, transform' : undefined,
              maxHeight: 'min(520px, 80vh)',
            }}
            role="document"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 py-3 px-3.5 border-b border-border shrink-0">
              {view === 'agents' ? (
                <button
                  type="button"
                  onClick={() => {
                    setView('commands');
                    setFocusedAgentIndex(0);
                  }}
                  title="Back to commands"
                  className="shrink-0 inline-flex items-center justify-center w-5 h-5 text-secondary hover:text-text cursor-pointer border-none bg-transparent p-0"
                >
                  <ChevronLeftIcon />
                </button>
              ) : (
                <SearchIcon />
              )}
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setVisiblePlanCount(INITIAL_PLAN_BATCH_SIZE);
                  setFocusedAgentIndex(0);
                  onSearch(e.target.value);
                  resetFocus();
                }}
                onKeyDown={onInputKeyDown}
                placeholder={
                  view === 'agents' ? 'Filter agents...' : 'Type a command or search your plans...'
                }
                className="flex-1 outline-none bg-transparent border-none font-[inherit] text-[14px] text-text"
              />
              <button
                type="button"
                onClick={closeModal}
                className="font-[inherit] text-[11px] text-tertiary border border-border bg-hover rounded-[6px] py-1 px-2 cursor-pointer"
              >
                Esc
              </button>
            </div>

            <div
              ref={scrollRef}
              onScroll={handleResultsScroll}
              className="flex-1 overflow-y-auto p-2"
            >
              {view === 'agents' ? (
                <AgentsView
                  rows={filteredAgentRows}
                  totalCount={agentRows.length}
                  focusedIndex={focusedAgentIndex}
                  onFocus={setFocusedAgentIndex}
                  onSelect={(agent) => applyAgent(agent)}
                />
              ) : flatItems.length === 0 ? (
                <div className="p-3 text-[12px] text-tertiary text-center">No results</div>
              ) : (
                <>
                  {flatItems.map((item) => {
                    if (item.type === 'group-header') {
                      return (
                        <div
                          key={`gh-${item.groupLabel}`}
                          className="text-[11px] font-medium text-tertiary tracking-[0.04em] uppercase px-2 pt-3 pb-1.5"
                        >
                          {item.groupLabel}
                        </div>
                      );
                    }

                    if (item.type === 'command' && item.command) {
                      const cmd = item.command;
                      const fi = getFocusableIndex(item);
                      const focused = fi === focusedIndex;
                      const gated = cmd.proOnly && !isPro;

                      return (
                        <button
                          key={cmd.id}
                          type="button"
                          data-focused={focused || undefined}
                          className="w-full text-left flex items-center gap-2.5 py-2 px-2.5 rounded-lg cursor-pointer border-none font-[inherit] transition-colors duration-75"
                          style={{
                            background: focused ? 'var(--hover)' : 'transparent',
                            opacity: gated ? 0.5 : 1,
                          }}
                          onClick={() => {
                            executeItem(item);
                          }}
                          onMouseEnter={() => setFocusedIndex(fi)}
                        >
                          <span className="shrink-0 text-secondary w-[18px] h-[18px] flex items-center justify-center">
                            {cmd.icon}
                          </span>
                          <span className="flex-1 text-[13px] text-text font-medium">
                            {cmd.label}
                          </span>
                          {gated && (
                            <span className="text-[10px] font-semibold text-tertiary border border-border rounded px-1.5 py-0.5 uppercase tracking-wider">
                              Pro
                            </span>
                          )}
                        </button>
                      );
                    }

                    if (item.type === 'plan' && item.plan) {
                      const plan = item.plan;
                      const fi = getFocusableIndex(item);
                      const focused = fi === focusedIndex;
                      const unseen =
                        planState.isUnseen(plan.id, plan.updatedAt) && plan.id !== selectedId;

                      return (
                        <div
                          key={plan.id}
                          className="flex items-stretch gap-1"
                          data-focused={focused || undefined}
                        >
                          <button
                            type="button"
                            className="flex-1 min-w-0 text-left block py-2.5 px-2.5 rounded-lg cursor-pointer border-none font-[inherit] transition-colors duration-75"
                            style={{
                              background: focused
                                ? 'var(--hover)'
                                : plan.id === selectedId
                                  ? 'var(--active)'
                                  : 'transparent',
                            }}
                            onClick={() => {
                              planState.markSeen(plan.id, plan.updatedAt);
                              onSelectPlan(plan);
                              closeModal();
                            }}
                            onMouseEnter={() => setFocusedIndex(fi)}
                          >
                            <div
                              className="relative font-medium text-[13px] leading-[1.35] text-text tracking-[0] overflow-hidden line-clamp-2"
                              style={{ paddingLeft: unseen ? '14px' : undefined }}
                            >
                              {unseen && (
                                <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                              )}
                              {plan.title}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-[11.5px] text-tertiary">
                              <AgentIcon agent={plan.agent} size={11} />
                              <span>{getAgentLabel(plan.agent)}</span>
                              <span>&middot;</span>
                              <span>{timeAgo(plan.updatedAt)}</span>
                            </div>
                          </button>
                          {onOpenInSplitView && (
                            <button
                              type="button"
                              onClick={() => {
                                planState.markSeen(plan.id, plan.updatedAt);
                                onOpenInSplitView(plan);
                                closeModal();
                              }}
                              disabled={plan.id === selectedId || plan.id === splitPlanId}
                              title="Open in split view"
                              className="shrink-0 flex items-center justify-center w-9 cursor-pointer"
                              style={{
                                color:
                                  plan.id === selectedId || plan.id === splitPlanId
                                    ? 'var(--tertiary)'
                                    : 'var(--secondary)',
                                opacity:
                                  plan.id === selectedId || plan.id === splitPlanId ? 0.4 : 0.6,
                                cursor:
                                  plan.id === selectedId || plan.id === splitPlanId
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                              onMouseEnter={(e) => {
                                if (plan.id !== selectedId && plan.id !== splitPlanId) {
                                  e.currentTarget.style.opacity = '0.9';
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.opacity =
                                  plan.id === selectedId || plan.id === splitPlanId ? '0.4' : '0.6';
                              }}
                            >
                              <svg
                                aria-hidden="true"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                                className="w-3.5 h-3.5"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M9 4.5v15m6-15v15M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    }

                    return null;
                  })}
                  {hasMorePlans && (
                    <div className="px-2.5 pt-2 pb-1 text-[11px] text-tertiary">
                      Showing {renderedPlanCount} of {filteredPlansCount} plans, scroll to load
                      more.
                    </div>
                  )}
                </>
              )}
            </div>

            {footerHint && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-border shrink-0">
                <kbd className="text-[11px] text-tertiary border border-border rounded-[4px] py-0.5 px-1.5 bg-hover leading-none">
                  &#x23CE;
                </kbd>
                <span className="text-[12px] text-secondary">{footerHint}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AgentsView({
  rows,
  totalCount,
  focusedIndex,
  onFocus,
  onSelect,
}: {
  rows: AgentRow[];
  totalCount: number;
  focusedIndex: number;
  onFocus: (index: number) => void;
  onSelect: (agent: string) => void;
}) {
  return (
    <>
      <div className="text-[11px] font-medium text-tertiary tracking-[0.04em] uppercase px-2 pt-3 pb-1.5">
        Agents ({totalCount})
      </div>
      {rows.length === 0 ? (
        <div className="p-3 text-[12px] text-tertiary text-center">
          {totalCount === 0 ? 'No agents have created plans yet.' : 'No agents match your search.'}
        </div>
      ) : (
        rows.map((row, index) => {
          const focused = index === focusedIndex;
          return (
            <button
              key={row.agent}
              type="button"
              data-focused={focused || undefined}
              className="w-full text-left flex items-center gap-2.5 py-2 px-2.5 rounded-lg cursor-pointer border-none font-[inherit] transition-colors duration-75"
              style={{
                background: focused ? 'var(--hover)' : 'transparent',
              }}
              onClick={() => onSelect(row.agent)}
              onMouseEnter={() => onFocus(index)}
            >
              <span className="shrink-0 w-[18px] h-[18px] flex items-center justify-center">
                <AgentIcon agent={row.agent} size={14} />
              </span>
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-[13px] text-text font-medium truncate">
                  {getAgentLabel(row.agent)}
                </span>
                <span className="text-[11.5px] text-tertiary truncate">
                  Last plan {timeAgo(row.latestUpdatedAt)} ago
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-tertiary tabular-nums border border-border rounded-full px-2 py-0.5">
                {row.planCount} {row.planCount === 1 ? 'plan' : 'plans'}
              </span>
            </button>
          );
        })
      )}
    </>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px] opacity-50 shrink-0"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

function CloseSplitIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 1v10M1 6h10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function MarkReadIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25"
      />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.503 1.503 0 0 0 2.124 2.122l7.81-7.81"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 8.002-4.248 1 1 0 0 0 1-1.75Z"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
      />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="var(--danger)"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function OutlineIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </svg>
  );
}
