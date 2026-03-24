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
  const {
    search,
    onSearch,
    plans,
    selectedId,
    onSelectPlan,
    splitPlanId,
    onOpenInSplitView,
    planState: planStateProp,
  } = props;
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

  function handleSplitSelect(plan: Plan) {
    if (!onOpenInSplitView) return;
    planState.markSeen(plan.id, plan.updatedAt);
    onOpenInSplitView(plan);
    closeModal();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="flex items-center gap-2 rounded-lg"
        style={{
          padding: '5px 8px',
          border: '1px solid var(--border)',
          background: 'transparent',
          minWidth: 0,
          width: '100%',
          maxWidth: '150px',
          overflow: 'hidden',
          color: 'var(--secondary)',
          cursor: 'pointer',
        }}
      >
        <SearchIcon />
        <span
          style={{
            fontSize: '12px',
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Search
        </span>
        <kbd
          style={{
            fontFamily: 'inherit',
            fontSize: '10px',
            lineHeight: 1,
            flexShrink: 0,
            color: 'var(--tertiary)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '3px 4px',
            background: 'var(--hover)',
          }}
        >
          {isMac ? '⌘K' : 'Ctrl+K'}
        </kbd>
      </button>

      {mounted && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex justify-center px-4"
          style={{
            background: 'rgba(0,0,0,0.44)',
            opacity: open ? 1 : 0,
            backdropFilter: open ? 'blur(3px)' : 'blur(0px)',
            paddingTop: '84px',
            transition: 'opacity 220ms ease, backdrop-filter 260ms ease',
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              height: 'fit-content',
              border: '1px solid var(--border)',
              borderRadius: '14px',
              background: 'var(--surface)',
              boxShadow: '0 24px 50px rgba(0,0,0,0.22)',
              overflow: 'hidden',
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0px) scale(1)' : 'translateY(-10px) scale(0.98)',
              transition: 'opacity 220ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: open ? 'opacity, transform' : undefined,
            }}
            role="document"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center gap-3"
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredPlans[0]) {
                    if (e.shiftKey && onOpenInSplitView) {
                      handleSplitSelect(filteredPlans[0]);
                    } else {
                      handleSelect(filteredPlans[0]);
                    }
                  }
                }}
                placeholder="Search plans..."
                className="flex-1 outline-none"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  color: 'var(--text)',
                }}
              />
              <button
                type="button"
                onClick={closeModal}
                style={{
                  fontFamily: 'inherit',
                  fontSize: '11px',
                  color: 'var(--tertiary)',
                  border: '1px solid var(--border)',
                  background: 'var(--hover)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                Esc
              </button>
            </div>
            <div
              style={{
                maxHeight: '380px',
                overflowY: 'auto',
                padding: '8px',
              }}
            >
              <div
                style={{
                  padding: '4px 8px 8px',
                  fontSize: '11px',
                  color: 'var(--tertiary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {search.trim().length > 0
                  ? `${filteredPlans.length} of ${plans.length} plans`
                  : `${plans.length} plans`}
              </div>

              {filteredPlans.length === 0 ? (
                <div
                  style={{
                    padding: '8px',
                    fontSize: '12px',
                    color: 'var(--tertiary)',
                  }}
                >
                  No matching plans
                </div>
              ) : (
                <>
                  {unseenFiltered.length > 0 && (
                    <div style={{ marginBottom: '4px' }}>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#3b82f6',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          padding: '6px 8px 4px',
                        }}
                      >
                        Updated ({unseenFiltered.length})
                      </div>
                      {unseenFiltered.map((plan) => (
                        <SearchPlanRow
                          key={plan.id}
                          plan={plan}
                          selected={plan.id === selectedId}
                          unseen
                          onClick={() => handleSelect(plan)}
                          onSplitView={
                            onOpenInSplitView ? () => handleSplitSelect(plan) : undefined
                          }
                          splitDisabled={plan.id === selectedId || plan.id === splitPlanId}
                        />
                      ))}
                      <div
                        style={{
                          height: '1px',
                          background: 'var(--border)',
                          margin: '6px 8px',
                        }}
                      />
                    </div>
                  )}
                  {restFiltered.map((plan) => (
                    <SearchPlanRow
                      key={plan.id}
                      plan={plan}
                      selected={plan.id === selectedId}
                      unseen={planState.isUnseen(plan.id, plan.updatedAt)}
                      onClick={() => handleSelect(plan)}
                      onSplitView={onOpenInSplitView ? () => handleSplitSelect(plan) : undefined}
                      splitDisabled={plan.id === selectedId || plan.id === splitPlanId}
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
  onSplitView,
  splitDisabled,
}: {
  plan: Plan;
  selected: boolean;
  unseen: boolean;
  onClick: () => void;
  onSplitView?: () => void;
  splitDisabled?: boolean;
}) {
  return (
    <div
      className="flex items-stretch gap-1"
      style={{
        borderRadius: '8px',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left block"
        style={{
          padding: '10px 8px',
          borderRadius: '8px',
          background: selected ? 'var(--active)' : 'transparent',
          cursor: 'pointer',
          border: 'none',
          fontFamily: 'inherit',
        }}
      >
        <div
          style={{
            position: 'relative',
            fontWeight: 500,
            fontSize: '13px',
            lineHeight: 1.35,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
            paddingLeft: unseen ? '14px' : undefined,
          }}
        >
          {unseen && (
            <span
              className="unseen-dot"
              style={{
                position: 'absolute',
                left: '2px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#3b82f6',
              }}
            />
          )}
          {plan.title}
        </div>
        <div
          className="flex items-center gap-1.5"
          style={{ marginTop: '4px', fontSize: '11.5px', color: 'var(--tertiary)' }}
        >
          <AgentIcon agent={plan.agent} size={11} />
          <span>{getAgentLabel(plan.agent)}</span>
          <span>&middot;</span>
          <span>{timeAgo(plan.updatedAt)}</span>
        </div>
      </button>
      {onSplitView && (
        <button
          type="button"
          onClick={onSplitView}
          disabled={splitDisabled}
          title="Open in split view"
          className="shrink-0 flex items-center justify-center w-9 rounded-lg border border-border bg-transparent cursor-pointer transition-[opacity,background] duration-150"
          style={{
            color: splitDisabled ? 'var(--tertiary)' : 'var(--secondary)',
            opacity: splitDisabled ? 0.4 : 0.6,
            cursor: splitDisabled ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!splitDisabled) {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.background = 'var(--hover)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = splitDisabled ? '0.4' : '0.6';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <SplitViewIcon />
        </button>
      )}
    </div>
  );
}

function SplitViewIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      style={{ width: '14px', height: '14px' }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 4.5v15m6-15v15M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z"
      />
    </svg>
  );
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
      style={{ width: '14px', height: '14px', color: 'var(--tertiary)' }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
      />
    </svg>
  );
}
