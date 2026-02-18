import { useEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from '../lib/api.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { filterPlans } from '../lib/plan-search.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { useSeenPlans } from '../hooks/useSeenPlans.ts';

export function SearchBar({
  search,
  onSearch,
  plans,
  selectedId,
  onSelectPlan,
  isPro,
}: {
  search: string;
  onSearch: (q: string) => void;
  plans: Plan[];
  selectedId: string | undefined;
  onSelectPlan: (plan: Plan) => void;
  isPro: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const filteredPlans = useMemo(() => filterPlans(plans, search), [plans, search]);
  const { isUnseen, markSeen } = useSeenPlans();
  const modalExitMs = 220;

  const { unseenFiltered, restFiltered } = useMemo(() => {
    if (!isPro) return { unseenFiltered: [] as Plan[], restFiltered: filteredPlans };
    const unseen: Plan[] = [];
    const rest: Plan[] = [];
    for (const p of filteredPlans) {
      if (isUnseen(p.id, p.updatedAt) && p.id !== selectedId) {
        unseen.push(p);
      } else {
        rest.push(p);
      }
    }
    return { unseenFiltered: unseen, restFiltered: rest };
  }, [filteredPlans, isPro, isUnseen, selectedId]);

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return true;
    return /Mac|iPhone|iPad/i.test(navigator.platform);
  }, []);

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
  }, []);

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

  function clearCloseTimer() {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }

  function openModal() {
    clearCloseTimer();
    if (openFrameRef.current) cancelAnimationFrame(openFrameRef.current);
    setMounted(true);
    openFrameRef.current = requestAnimationFrame(() => {
      setOpen(true);
    });
  }

  function closeModal() {
    if (openFrameRef.current) cancelAnimationFrame(openFrameRef.current);
    setOpen(false);
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setMounted(false);
      closeTimerRef.current = undefined;
    }, modalExitMs);
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
                    onSelectPlan(filteredPlans[0]);
                    closeModal();
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
                          onClick={() => {
                            if (isPro) markSeen(plan.id, plan.updatedAt);
                            onSelectPlan(plan);
                            closeModal();
                          }}
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
                      unseen={false}
                      onClick={() => {
                        if (isPro) markSeen(plan.id, plan.updatedAt);
                        onSelectPlan(plan);
                        closeModal();
                      }}
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
      className="w-full text-left block"
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
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      style={{ width: '14px', height: '14px', opacity: 0.5, flexShrink: 0 }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}
