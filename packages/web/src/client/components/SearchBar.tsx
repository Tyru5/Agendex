import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlanState } from '../hooks/usePlanState.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { filterPlans } from '../lib/plan-search.ts';
import type { PlanState } from '../lib/plan-state.ts';
import { AgentIcon } from './AgentIcon.tsx';

type SearchBarProps = {
  search: string;
  onSearch: (q: string) => void;
  plans: Plan[];
  selectedId: string | undefined;
  onSelectPlan: (plan: Plan) => void;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
  isPro?: boolean;
  planState?: PlanState;
};

export function SearchBar(props: SearchBarProps) {
  const { search, onSearch, plans, selectedId, onSelectPlan, planState: planStateProp } = props;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const filteredPlans = useMemo(() => filterPlans(plans, search), [plans, search]);
  const localPlanState = usePlanState();
  const planState = planStateProp ?? localPlanState;
  const modalExitMs = 220;

  const { unseenFiltered, restFiltered } = useMemo(() => {
    const unseen: Plan[] = [];
    const rest: Plan[] = [];
    for (const plan of filteredPlans) {
      if (planState.isUnseen(plan.id, plan.updatedAt) && plan.id !== selectedId) {
        unseen.push(plan);
      } else {
        rest.push(plan);
      }
    }
    return { unseenFiltered: unseen, restFiltered: rest };
  }, [filteredPlans, planState, selectedId]);

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

  function handleSelect(plan: Plan) {
    planState.markSeen(plan.id, plan.updatedAt);
    onSelectPlan(plan);
    closeModal();
  }

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
            className="w-[min(720px,100%)] h-fit border border-border rounded-[14px] bg-surface shadow-[0_24px_50px_rgba(0,0,0,0.22)] overflow-hidden"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0px) scale(1)' : 'translateY(-10px) scale(0.98)',
              transition: 'opacity 220ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: open ? 'opacity, transform' : undefined,
            }}
            role="document"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 py-3 px-3.5 border-b border-border">
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredPlans[0]) {
                    handleSelect(filteredPlans[0]);
                  }
                }}
                placeholder="Search plans..."
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
            <div className="max-h-[380px] overflow-y-auto p-2">
              <div className="pt-1 px-2 pb-2 text-[11px] text-tertiary tabular-nums">
                {search.trim().length > 0
                  ? `${filteredPlans.length} of ${plans.length} plans`
                  : `${plans.length} plans`}
              </div>

              {filteredPlans.length === 0 ? (
                <div className="p-2 text-[12px] text-tertiary">No matching plans</div>
              ) : (
                <>
                  {unseenFiltered.length > 0 && (
                    <div className="mb-1">
                      <div className="text-[11px] font-semibold text-[#3b82f6] tracking-[0.04em] uppercase px-2 pt-1.5 pb-1">
                        Updated ({unseenFiltered.length})
                      </div>
                      {unseenFiltered.map((plan) => (
                        <SearchPlanRow
                          key={plan.id}
                          plan={plan}
                          selected={plan.id === selectedId}
                          unseen
                          onClick={() => handleSelect(plan)}
                        />
                      ))}
                      <div className="h-px bg-border mx-2 my-1.5" />
                    </div>
                  )}
                  {restFiltered.map((plan) => (
                    <SearchPlanRow
                      key={plan.id}
                      plan={plan}
                      selected={plan.id === selectedId}
                      unseen={planState.isUnseen(plan.id, plan.updatedAt)}
                      onClick={() => handleSelect(plan)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SearchPlanRow({
  plan,
  selected,
  unseen,
  onClick,
}: {
  plan: Plan;
  selected: boolean;
  unseen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left block py-2.5 px-2.5 rounded-lg cursor-pointer border-none font-[inherit]"
      style={{
        background: selected ? 'var(--active)' : 'transparent',
      }}
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
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
      className="w-3.5 h-3.5 text-tertiary"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
      />
    </svg>
  );
}
