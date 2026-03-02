import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgentIcon,
  filterPlans,
  getAgentLabel,
  useSeenPlans,
  useTheme,
  type Plan,
} from '@agendex/web';
import { useCommandItems, type Command, type FlatItem } from './useCommandItems';

export function CommandPalette({
  search,
  onSearch,
  plans,
  selectedId,
  onSelectPlan,
  isPro,
  mode,
  onNewPlan,
  onUpload,
  onNavigate,
  onShowPricing,
}: {
  search: string;
  onSearch: (q: string) => void;
  plans: Plan[];
  selectedId: string | undefined;
  onSelectPlan: (plan: Plan) => void;
  isPro: boolean;
  mode: 'local' | 'cloud';
  onNewPlan: () => void;
  onUpload: () => void;
  onNavigate: (path: string) => void;
  onShowPricing: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openFrameRef = useRef<ReturnType<typeof requestAnimationFrame>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isUnseen, markSeen } = useSeenPlans();
  const { resolvedTheme, setTheme } = useTheme();
  const modalExitMs = 220;

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return true;
    return /Mac|iPhone|iPad/i.test(navigator.platform);
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const openModal = useCallback(() => {
    clearCloseTimer();
    if (openFrameRef.current) cancelAnimationFrame(openFrameRef.current);
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
        closeModal();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeModal, openModal]);

  useEffect(() => {
    if (!open) return;
    const timerId = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timerId);
  }, [open]);

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

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

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
          onNavigate('/settings');
        }
      },
    });

    cmds.push({
      id: 'view-agents',
      label: 'View All Agents',
      group: 'plans',
      icon: <BoxIcon />,
      footerHint: 'Browse available agents',
      action: () => {
        onSearch('');
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
      action: () => window.open('https://agendex.dev/docs', '_blank'),
    });

    cmds.push({
      id: 'report-issue',
      label: 'Report Issue',
      group: 'support',
      icon: <FlagIcon />,
      footerHint: 'Report a bug or issue',
      action: () => window.open('https://github.com/agendex/agendex/issues', '_blank'),
    });

    return cmds;
  }, [
    mode,
    isPro,
    resolvedTheme,
    onNewPlan,
    onUpload,
    onNavigate,
    onShowPricing,
    onSearch,
    toggleTheme,
  ]);

  const {
    flatItems,
    focusableItems,
    focusedIndex,
    setFocusedIndex,
    footerHint,
    onKeyDown,
    resetFocus,
    filteredPlans,
  } = useCommandItems({
    commands,
    plans,
    search,
    selectedPlanId: selectedId,
    isPro,
    onClose: closeModal,
  });

  const getFocusableIndex = useCallback(
    (item: FlatItem) => {
      if (item.type === 'command') {
        return focusableItems.findIndex(
          (fi) => fi.type === 'command' && fi.command?.id === item.command?.id,
        );
      }
      if (item.type === 'plan') {
        return focusableItems.findIndex(
          (fi) => fi.type === 'plan' && fi.plan?.id === item.plan?.id,
        );
      }
      return -1;
    },
    [focusableItems],
  );

  useEffect(() => {
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
  }, [focusedIndex]);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="flex items-center gap-2 rounded-lg py-[5px] px-2 border border-border bg-transparent min-w-0 w-full max-w-[150px] overflow-hidden text-secondary cursor-pointer"
      >
        <SearchIcon />
        <span className="text-[12px] flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden text-ellipsis">
          Search
        </span>
        <kbd className="font-[inherit] text-[10px] leading-none shrink-0 text-tertiary border border-border rounded-[4px] py-[3px] px-1 bg-hover">
          {isMac ? '⌘K' : 'Ctrl+K'}
        </kbd>
      </button>

      {mounted && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center px-4"
          style={{
            background: 'rgba(0,0,0,0.44)',
            opacity: open ? 1 : 0,
            backdropFilter: open ? 'blur(3px)' : 'blur(0px)',
            transition: 'opacity 220ms ease, backdrop-filter 260ms ease',
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="w-[min(560px,100%)] h-fit border border-border rounded-[14px] bg-surface shadow-[0_24px_50px_rgba(0,0,0,0.22)] overflow-hidden flex flex-col"
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
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => {
                  onSearch(e.target.value);
                  resetFocus();
                }}
                onKeyDown={onKeyDown}
                placeholder="Type a command or search your plans..."
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

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
              {flatItems.length === 0 ? (
                <div className="p-3 text-[12px] text-tertiary text-center">No results</div>
              ) : (
                flatItems.map((item, i) => {
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
                          cmd.action();
                          closeModal();
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
                      isPro && isUnseen(plan.id, plan.updatedAt) && plan.id !== selectedId;

                    return (
                      <button
                        key={plan.id}
                        type="button"
                        data-focused={focused || undefined}
                        className="w-full text-left block py-2.5 px-2.5 rounded-lg cursor-pointer border-none font-[inherit] transition-colors duration-75"
                        style={{
                          background: focused
                            ? 'var(--hover)'
                            : plan.id === selectedId
                              ? 'var(--active)'
                              : 'transparent',
                        }}
                        onClick={() => {
                          if (isPro) markSeen(plan.id, plan.updatedAt);
                          onSelectPlan(plan);
                          closeModal();
                        }}
                        onMouseEnter={() => setFocusedIndex(fi)}
                      >
                        <div
                          className="relative font-medium text-[13px] leading-[1.35] text-text tracking-[-0.01em] overflow-hidden line-clamp-2"
                          style={{ paddingLeft: unseen ? '14px' : undefined }}
                        >
                          {unseen && (
                            <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
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
                    );
                  }

                  return null;
                })
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
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
