import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSeenPlans } from '../hooks/useSeenPlans.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';

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

function PlanRow({
  plan,
  selected,
  unseen,
  onClick,
  isSplit,
  onContextMenu,
}: {
  plan: Plan;
  selected: boolean;
  unseen: boolean;
  onClick: () => void;
  isSplit?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const titleRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    setOverflows(el.scrollWidth > el.clientWidth);
  }, [plan.title]);

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full text-left block plan-row${selected ? ' plan-row--selected' : ''}${isSplit ? ' plan-row--split' : ''} py-2.5 px-2 rounded-[7px] cursor-pointer border-none font-[inherit]`}
      style={{
        background: selected ? 'var(--active)' : isSplit ? 'var(--hover)' : 'transparent',
        border: isSplit ? '1px dashed var(--border)' : undefined,
      }}
    >
      <div
        ref={titleRef}
        className={`plan-title${overflows ? ' plan-title--fade' : ''}`}
        style={{ paddingLeft: unseen ? '14px' : undefined }}
      >
        {unseen && (
          <span className="unseen-dot absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
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

export function PlanList({
  plans,
  selectedId,
  onSelect,
  isPro = false,
  splitPlanId,
  onOpenInSplitView,
}: {
  plans: Plan[];
  selectedId: string | undefined;
  onSelect: (plan: Plan) => void;
  isPro?: boolean;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
}) {
  const { isUnseen, markSeen, markAllSeen } = useSeenPlans();
  const [contextMenu, setContextMenu] = useState<{ plan: Plan; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleClose() {
      setContextMenu(null);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('pointerdown', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  function handleContextMenu(e: React.MouseEvent, plan: Plan) {
    if (!onOpenInSplitView) return;
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 48);
    setContextMenu({ plan, x, y });
  }

  useEffect(() => {
    if (!isPro || !selectedId) return;
    const plan = plans.find((p) => p.id === selectedId);
    if (plan) markSeen(plan.id, plan.updatedAt);
  }, [isPro, selectedId, plans, markSeen]);

  const { unseenPlans, restPlans } = useMemo(() => {
    if (!isPro) return { unseenPlans: [] as Plan[], restPlans: plans };
    const unseen: Plan[] = [];
    const rest: Plan[] = [];
    for (const p of plans) {
      if (isUnseen(p.id, p.updatedAt) && p.id !== selectedId) {
        unseen.push(p);
      } else {
        rest.push(p);
      }
    }
    return { unseenPlans: unseen, restPlans: rest };
  }, [plans, isPro, isUnseen, selectedId]);

  if (plans.length === 0) {
    return <div className="p-4 text-[13px] text-tertiary">No plans found</div>;
  }

  function handleClick(plan: Plan) {
    if (isPro) markSeen(plan.id, plan.updatedAt);
    onSelect(plan);
  }

  return (
    <div className="w-full">
      {unseenPlans.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between px-2 pt-1.5 pb-1 w-full">
            <span className="text-[11px] font-semibold text-[#3b82f6] tracking-[0.04em] uppercase">
              Updated ({unseenPlans.length})
            </span>
            <button
              type="button"
              onClick={() => markAllSeen(unseenPlans)}
              className="text-[11px] text-tertiary bg-none border-none cursor-pointer p-0 font-[inherit] whitespace-nowrap"
            >
              Mark all read
            </button>
          </div>
          {unseenPlans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedId}
              unseen
              onClick={() => handleClick(plan)}
              isSplit={plan.id === splitPlanId}
              onContextMenu={(e) => handleContextMenu(e, plan)}
            />
          ))}
          <div className="h-px bg-border mx-2 my-1.5" />
        </div>
      )}
      {restPlans.map((plan) => (
        <PlanRow
          key={plan.id}
          plan={plan}
          selected={plan.id === selectedId}
          unseen={false}
          onClick={() => handleClick(plan)}
          isSplit={plan.id === splitPlanId}
          onContextMenu={(e) => handleContextMenu(e, plan)}
        />
      ))}
      {contextMenu &&
        onOpenInSplitView &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 200,
              minWidth: '180px',
              padding: '4px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={contextMenu.plan.id === selectedId}
              onClick={() => {
                onOpenInSplitView(contextMenu.plan);
                setContextMenu(null);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 450,
                fontFamily: 'inherit',
                borderRadius: '7px',
                border: 'none',
                background: 'transparent',
                color: contextMenu.plan.id === selectedId ? 'var(--tertiary)' : 'var(--text)',
                cursor: contextMenu.plan.id === selectedId ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                if (contextMenu.plan.id !== selectedId) {
                  e.currentTarget.style.background = 'var(--hover)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                style={{ width: '14px', height: '14px', flexShrink: 0 }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 4.5v15m6-15v15M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z"
                />
              </svg>
              Open in Split View
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
