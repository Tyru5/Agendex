import {
  AgentIcon,
  deriveFilterChips,
  filterPlans,
  FOCUS_PLAN_SEARCH_EVENT,
  getAgentLabel,
  type AgentStats,
  type Plan,
  type PlanDateBucket,
  type PlanFilterChip,
  type PlanState,
  type SidebarSortBy,
  usePlanState,
  useTheme,
} from '@agendex/web';
import {
  type ReactNode,
  type SelectHTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Command, useCommandItems } from './useCommandItems';

const INITIAL_PLAN_BATCH_SIZE = 100;
const PLAN_BATCH_SIZE = 100;

type PaletteView = 'commands' | 'filters';

type TagOption = { _id: string; name: string; color?: string };
type CollectionOption = { _id: string; name: string };

export type CommandPaletteFilters = {
  sortBy: SidebarSortBy;
  onSortChange: (sort: SidebarSortBy) => void;
  dateBucket: PlanDateBucket;
  onDateBucketChange: (bucket: PlanDateBucket) => void;
  agents: AgentStats[];
  selectedAgents: readonly string[];
  onAgentsChange: (agents: string[]) => void;
  workspace?: string;
  onWorkspaceChange: (workspace: string | undefined) => void;
  workspaces: readonly string[];
  tags?: readonly TagOption[];
  selectedTags: readonly string[];
  onTagSelect: (tagIds: string[]) => void;
  collections?: readonly CollectionOption[];
  selectedCollection?: string;
  onCollectionSelect: (id: string | undefined) => void;
  onClearAll: () => void;
};

type ActiveFilterChip =
  | PlanFilterChip
  | {
      key: 'sort';
      kind: 'sort';
      value: SidebarSortBy;
      label: string;
    };

const SORT_OPTIONS: Array<{ value: SidebarSortBy; label: string; chip: string }> = [
  { value: 'updatedAt', label: 'Last modified', chip: 'Modified' },
  { value: 'createdAt', label: 'Date created', chip: 'Created' },
  { value: 'title', label: 'Title', chip: 'Title' },
];

const DATE_OPTIONS: Array<{ value: PlanDateBucket; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: '1d' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

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
  onShowChangelog,
  filteredPlans: externallyFilteredPlans,
  filters,
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
  onShowChangelog?: () => void;
  filteredPlans?: Plan[];
  filters?: CommandPaletteFilters;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visiblePlanCount, setVisiblePlanCount] = useState(INITIAL_PLAN_BATCH_SIZE);
  const [view, setView] = useState<PaletteView>('commands');
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
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        openModal();
      }
      if (e.key === 'Escape') {
        if (mounted && view === 'filters') {
          e.preventDefault();
          setView('commands');
        } else {
          closeModal();
        }
      }
    }
    function onFocusPlanSearch() {
      openModal();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(FOCUS_PLAN_SEARCH_EVENT, onFocusPlanSearch);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(FOCUS_PLAN_SEARCH_EVENT, onFocusPlanSearch);
    };
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

  const filteredPlans = useMemo(
    () => externallyFilteredPlans ?? filterPlans(plans, search),
    [externallyFilteredPlans, plans, search],
  );

  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    if (!filters) return [];

    const chips: ActiveFilterChip[] = deriveFilterChips(
      {
        q: search,
        agents: filters.selectedAgents,
        workspace: filters.workspace,
        date: filters.dateBucket,
        tagIds: filters.selectedTags,
        collectionId: filters.selectedCollection,
      },
      {
        agents: new Map(filters.agents.map((agent) => [agent.agent, getAgentLabel(agent.agent)])),
        tags: new Map(filters.tags?.map((tag) => [tag._id, tag.name]) ?? []),
        collections: new Map(
          filters.collections?.map((collection) => [collection._id, collection.name]) ?? [],
        ),
      },
    );

    if (filters.sortBy !== 'updatedAt') {
      chips.push({
        key: 'sort',
        kind: 'sort',
        value: filters.sortBy,
        label: SORT_OPTIONS.find((option) => option.value === filters.sortBy)?.chip ?? 'Sort',
      });
    }

    return chips;
  }, [filters, search]);

  const removeFilterChip = useCallback(
    (chip: ActiveFilterChip) => {
      if (!filters) return;

      switch (chip.kind) {
        case 'agent':
          filters.onAgentsChange(filters.selectedAgents.filter((agent) => agent !== chip.value));
          return;
        case 'workspace':
          filters.onWorkspaceChange(undefined);
          return;
        case 'date':
          filters.onDateBucketChange('all');
          return;
        case 'tag':
          filters.onTagSelect(filters.selectedTags.filter((tagId) => tagId !== chip.value));
          return;
        case 'collection':
          filters.onCollectionSelect(undefined);
          return;
        case 'sort':
          filters.onSortChange('updatedAt');
          return;
        case 'search':
          onSearch('');
      }
    },
    [filters, onSearch],
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

    if (filters) {
      cmds.push({
        id: 'filter-plans',
        label:
          activeFilterChips.length > 0
            ? `Filter Plans (${activeFilterChips.length})`
            : 'Filter Plans',
        group: 'plans',
        icon: <FilterIcon />,
        footerHint: 'Refine plans by agent, workspace, date, tag, or collection',
        closeOnSelect: false,
        action: () => setView('filters'),
      });
    }

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

    if (onShowChangelog) {
      cmds.push({
        id: 'changelog',
        label: 'Changelog',
        group: 'support',
        icon: <SparkleIcon />,
        footerHint: 'View agendex-cli release notes',
        action: onShowChangelog,
      });
    }

    cmds.push({
      id: 'stack',
      label: 'Stack & Tools',
      group: 'support',
      icon: <ChartIcon />,
      footerHint: 'Tools, libraries, and packages used to build Agendex',
      action: () => onNavigate('/tools'),
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
    toggleTheme,
    onToggleOutline,
    onToggleChart,
    onDeletePlan,
    onShowChangelog,
    selectedId,
    planState,
    visibleUnseenPlans,
    filters,
    activeFilterChips.length,
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

  const footerHint =
    view === 'filters'
      ? `${filteredPlans.length} matching plan${filteredPlans.length === 1 ? '' : 's'} · Changes apply instantly`
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
  }, [focusedIndex, view]);

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={openModal}
          aria-label="Search and filter plans"
          className="agendex-topbar-button flex h-[30px] items-center gap-2 rounded-lg border border-border px-2.5 min-w-0 w-auto sm:w-full sm:max-w-[168px] overflow-hidden cursor-pointer"
        >
          <SearchIcon />
          <span className="hidden sm:block text-[12px] flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden text-ellipsis">
            Search plans
          </span>
          <kbd className="hidden lg:inline-flex font-[inherit] text-[11.5px] leading-none shrink-0 text-tertiary border border-border rounded-[4px] py-[3px] px-1 bg-hover">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      )}

      {mounted && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={view === 'filters' ? 'Plan filters' : 'Search plans and commands'}
          className="fixed inset-0 z-[120] flex items-start sm:items-center justify-center px-3 sm:px-4 py-[8vh] sm:py-4"
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
          <div className="relative w-[min(620px,100%)] h-fit">
            {open && <PaletteArrows />}
            <div
              className="agendex-popover relative z-[1] w-full h-fit rounded-[14px] overflow-hidden flex flex-col"
              style={{
                opacity: open ? 1 : 0,
                transform: open ? 'translateY(0px) scale(1)' : 'translateY(-10px) scale(0.98)',
                transition: 'opacity 220ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
                willChange: open ? 'opacity, transform' : undefined,
                maxHeight: 'min(640px, 84vh)',
              }}
              role="document"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 py-3 px-3.5 border-b border-border shrink-0">
                {view === 'filters' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setView('commands');
                    }}
                    aria-label="Back to search results"
                    title="Back to search results"
                    className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-secondary hover:text-text hover:bg-hover cursor-pointer border-none bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    <ChevronLeftIcon />
                  </button>
                ) : (
                  <SearchIcon />
                )}
                {view === 'filters' ? (
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] leading-tight font-semibold text-text">
                      Filter plans
                    </div>
                    <div className="mt-0.5 text-[11px] text-tertiary">
                      Narrow by source, workspace, or activity
                    </div>
                  </div>
                ) : (
                  <input
                    ref={inputRef}
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setVisiblePlanCount(INITIAL_PLAN_BATCH_SIZE);
                      onSearch(e.target.value);
                      resetFocus();
                    }}
                    onKeyDown={onCommandKeyDown}
                    placeholder="Search plans or type a command..."
                    aria-label="Search plans and commands"
                    className="flex-1 min-w-0 outline-none bg-transparent border-none font-[inherit] text-[14px] text-text placeholder:text-tertiary"
                  />
                )}
                {view === 'commands' && filters && (
                  <button
                    type="button"
                    onClick={() => setView('filters')}
                    aria-label={`Filters${activeFilterChips.length > 0 ? `, ${activeFilterChips.length} active` : ''}`}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                      activeFilterChips.length > 0
                        ? 'border-[var(--accent)] bg-active text-text'
                        : 'border-border bg-transparent text-secondary hover:bg-hover hover:text-text'
                    }`}
                  >
                    <FilterIcon />
                    <span className="hidden sm:inline">Filters</span>
                    {activeFilterChips.length > 0 && (
                      <span className="min-w-4 tabular-nums text-[11.5px] text-[var(--accent)]">
                        {activeFilterChips.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Close command palette"
                  className="font-[inherit] text-[11px] text-tertiary border border-border bg-hover rounded-[6px] py-1 px-2 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  Esc
                </button>
              </div>

              {view === 'commands' && activeFilterChips.length > 0 && filters && (
                <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-3.5 py-2 shrink-0">
                  <span className="mr-0.5 text-[11.5px] font-medium text-tertiary shrink-0">
                    Active
                  </span>
                  {activeFilterChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => removeFilterChip(chip)}
                      title={`Remove ${chip.label} filter`}
                      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-hover px-2 text-[11.5px] font-medium text-secondary hover:text-text cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    >
                      <span className="max-w-28 truncate">{chip.label}</span>
                      <CloseIcon />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={filters.onClearAll}
                    className="ml-auto shrink-0 border-0 bg-transparent px-1.5 py-1 text-[11.5px] font-medium text-tertiary hover:text-text cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    Clear all
                  </button>
                </div>
              )}

              <div
                ref={scrollRef}
                onScroll={handleResultsScroll}
                className={`flex-1 overflow-y-auto ${view === 'filters' ? 'p-0' : 'p-2'}`}
              >
                {view === 'filters' && filters ? (
                  <PlanFiltersView filters={filters} />
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
                              <span className="text-[11.5px] font-semibold text-tertiary border border-border rounded px-1.5 py-0.5 uppercase tracking-wider">
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
                                aria-label={`Open ${plan.title} in split view`}
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
                                    plan.id === selectedId || plan.id === splitPlanId
                                      ? '0.4'
                                      : '0.6';
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

              {footerHint && view === 'filters' ? (
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-t border-border shrink-0">
                  <span className="min-w-0 truncate text-[11.5px] text-secondary">
                    {footerHint}
                  </span>
                  <button
                    type="button"
                    onClick={() => setView('commands')}
                    className="shrink-0 rounded-md border border-border bg-hover px-2.5 py-1.5 text-[11.5px] font-medium text-text hover:border-[var(--tertiary)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    View results
                  </button>
                </div>
              ) : footerHint ? (
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-border shrink-0">
                  <kbd className="text-[11px] text-tertiary border border-border rounded-[4px] py-0.5 px-1.5 bg-hover leading-none">
                    &#x23CE;
                  </kbd>
                  <span className="text-[12px] text-secondary">{footerHint}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PlanFiltersView({ filters }: { filters: CommandPaletteFilters }) {
  const [agentQuery, setAgentQuery] = useState('');
  const selectedAgentSet = useMemo(() => new Set(filters.selectedAgents), [filters.selectedAgents]);
  const selectedTagSet = useMemo(() => new Set(filters.selectedTags), [filters.selectedTags]);
  const totalPlans = filters.agents.reduce((sum, agent) => sum + agent.planCount, 0);
  const visibleAgents = useMemo(() => {
    const query = agentQuery.trim().toLowerCase();
    const sorted = filters.agents
      .filter((agent) => agent.planCount > 0)
      .sort((a, b) => {
        if (b.planCount !== a.planCount) return b.planCount - a.planCount;
        return getAgentLabel(a.agent).localeCompare(getAgentLabel(b.agent));
      });

    if (!query) return sorted;
    return sorted.filter(
      (agent) =>
        agent.agent.toLowerCase().includes(query) ||
        getAgentLabel(agent.agent).toLowerCase().includes(query),
    );
  }, [agentQuery, filters.agents]);
  const selectedCollectionRecord = filters.collections?.find(
    (collection) => collection._id === filters.selectedCollection,
  );
  const showTags = Boolean(
    filters.tags && (filters.tags.length > 0 || filters.selectedTags.length > 0),
  );
  const showCollections = Boolean(
    filters.collections && (filters.collections.length > 0 || filters.selectedCollection),
  );

  function toggleAgent(agent: string) {
    filters.onAgentsChange(
      selectedAgentSet.has(agent)
        ? filters.selectedAgents.filter((selected) => selected !== agent)
        : [...filters.selectedAgents, agent],
    );
  }

  function toggleTag(tagId: string) {
    filters.onTagSelect(
      selectedTagSet.has(tagId)
        ? filters.selectedTags.filter((selected) => selected !== tagId)
        : [...filters.selectedTags, tagId],
    );
  }

  return (
    <div className="divide-y divide-border">
      <fieldset className="m-0 border-0 px-3.5 py-4 sm:px-4">
        <legend className="sr-only">Agents</legend>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <span className="text-[12px] font-semibold text-text">Agents</span>
          {filters.selectedAgents.length > 0 && (
            <button
              type="button"
              onClick={() => filters.onAgentsChange([])}
              className="border-0 bg-transparent p-1 text-[11.5px] font-medium text-tertiary hover:text-text cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              Clear
            </button>
          )}
        </div>
        {filters.agents.length >= 6 && (
          <div className="mb-2.5 flex h-8 items-center gap-2 rounded-md border border-border bg-[var(--surface)] px-2.5 focus-within:border-[var(--tertiary)]">
            <SearchIcon />
            <input
              type="search"
              value={agentQuery}
              onChange={(event) => setAgentQuery(event.target.value)}
              placeholder="Find agent"
              aria-label="Find agent"
              className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-text outline-none placeholder:text-tertiary"
            />
          </div>
        )}
        <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
          <FilterOption
            label="All agents"
            count={totalPlans}
            selected={filters.selectedAgents.length === 0}
            onClick={() => filters.onAgentsChange([])}
            icon={<span className="h-2 w-2 rounded-full bg-text" />}
          />
          {visibleAgents.map((agent) => (
            <FilterOption
              key={agent.agent}
              label={getAgentLabel(agent.agent)}
              count={agent.planCount}
              selected={selectedAgentSet.has(agent.agent)}
              onClick={() => toggleAgent(agent.agent)}
              icon={<AgentIcon agent={agent.agent} size={13} />}
            />
          ))}
          {visibleAgents.length === 0 && (
            <div className="px-2.5 py-3 text-[11.5px] text-tertiary">No agents match</div>
          )}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 px-3.5 py-4 sm:grid-cols-2 sm:px-4">
        <FilterField label="Workspace">
          <PaletteSelect
            value={filters.workspace ?? ''}
            onChange={(event) => filters.onWorkspaceChange(event.target.value || undefined)}
            aria-label="Workspace"
          >
            <option value="">All workspaces</option>
            {filters.workspace && !filters.workspaces.includes(filters.workspace) && (
              <option value={filters.workspace}>{filters.workspace}</option>
            )}
            {filters.workspaces.map((workspace) => (
              <option key={workspace} value={workspace}>
                {workspace}
              </option>
            ))}
          </PaletteSelect>
        </FilterField>

        <FilterField label="Sort">
          <PaletteSelect
            value={filters.sortBy}
            onChange={(event) => filters.onSortChange(event.target.value as SidebarSortBy)}
            aria-label="Sort plans"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </PaletteSelect>
        </FilterField>
      </div>

      <fieldset className="m-0 border-0 px-3.5 py-4 sm:px-4">
        <legend className="mb-2.5 p-0 text-[12px] font-semibold text-text">Modified</legend>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-[var(--surface)] p-1">
          {DATE_OPTIONS.map((option) => {
            const selected = filters.dateBucket === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => filters.onDateBucketChange(option.value)}
                aria-pressed={selected}
                className={`h-8 rounded-md border-0 text-[11.5px] font-medium cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                  selected
                    ? 'bg-active text-text shadow-[inset_0_0_0_1px_var(--border)]'
                    : 'bg-transparent text-tertiary hover:bg-hover hover:text-text'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {(showTags || showCollections) && (
        <div className="grid grid-cols-1 gap-4 px-3.5 py-4 sm:grid-cols-2 sm:px-4">
          {showTags && filters.tags && (
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="sr-only">Tags</legend>
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-text">Tags</span>
                {filters.selectedTags.length > 0 && (
                  <button
                    type="button"
                    onClick={() => filters.onTagSelect([])}
                    className="border-0 bg-transparent p-1 text-[11.5px] font-medium text-tertiary hover:text-text cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-1">
                {filters.tags.map((tag) => {
                  const selected = selectedTagSet.has(tag._id);
                  return (
                    <button
                      key={tag._id}
                      type="button"
                      onClick={() => toggleTag(tag._id)}
                      aria-pressed={selected}
                      className={`inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                        selected
                          ? 'border-[var(--tertiary)] bg-active text-text'
                          : 'border-border bg-transparent text-secondary hover:bg-hover hover:text-text'
                      }`}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: tag.color || 'var(--tertiary)' }}
                      />
                      <span className="max-w-28 truncate">{tag.name}</span>
                      {selected && <CheckIcon />}
                    </button>
                  );
                })}
                {filters.tags.length === 0 && filters.selectedTags.length > 0 && (
                  <button
                    type="button"
                    onClick={() => filters.onTagSelect([])}
                    className="rounded-md border border-border bg-active px-2 py-1.5 text-[11px] text-secondary cursor-pointer"
                  >
                    {filters.selectedTags.length} selected · Clear
                  </button>
                )}
              </div>
            </fieldset>
          )}

          {showCollections && filters.collections && (
            <FilterField label="Collection">
              <PaletteSelect
                value={filters.selectedCollection ?? ''}
                onChange={(event) => filters.onCollectionSelect(event.target.value || undefined)}
                aria-label="Collection"
              >
                <option value="">All plans</option>
                {filters.selectedCollection && !selectedCollectionRecord && (
                  <option value={filters.selectedCollection}>Selected collection</option>
                )}
                {filters.collections.map((collection) => (
                  <option key={collection._id} value={collection._id}>
                    {collection.name}
                  </option>
                ))}
              </PaletteSelect>
            </FilterField>
          )}
        </div>
      )}
    </div>
  );
}

function FilterOption({
  label,
  count,
  selected,
  onClick,
  icon,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
        selected
          ? 'border-[var(--tertiary)] bg-active text-text'
          : 'border-transparent bg-transparent text-secondary hover:border-border hover:bg-hover hover:text-text'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{label}</span>
      <span className="shrink-0 text-[11.5px] tabular-nums text-tertiary">{count}</span>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--accent)]">
        {selected && <CheckIcon />}
      </span>
    </button>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-[12px] font-semibold text-text">{label}</span>
      {children}
    </label>
  );
}

function PaletteSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative flex h-9 items-center rounded-lg border border-border bg-[var(--surface)] focus-within:border-[var(--tertiary)]">
      <select
        {...props}
        className={`h-full w-full appearance-none border-0 bg-transparent px-2.5 pr-8 text-[11.5px] font-medium text-text outline-none cursor-pointer ${className ?? ''}`}
      />
      <span className="pointer-events-none absolute right-2.5 flex text-tertiary">
        <ChevronDownIcon />
      </span>
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m2.25 6.25 2.25 2.2 5.25-5.1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <path d="m3 3 6 6M9 3 3 9" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 4.5 3 3 3-3" />
    </svg>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

function PaletteArrows() {
  return (
    <div className="command-palette-arrows" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <svg
          key={index}
          data-arrow={index + 1}
          viewBox="0 0 96 52"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path pathLength="1" d="M5 15C25 8 47 13 72 30C77 33 82 35 88 36" />
          <path pathLength="1" d="M75 22C79 29 83 33 88 36C82 38 76 42 72 47" />
        </svg>
      ))}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3h10M4 7h6M6 11h2" />
    </svg>
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

function SparkleIcon() {
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
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
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
