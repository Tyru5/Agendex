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
  isSplit,
  onClick,
  onContextMenu,
}: {
  plan: Plan;
  selected: boolean;
  unseen: boolean;
  isSplit?: boolean;
  onClick: () => void;
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
      className={`w-full text-left block plan-row${selected ? ' plan-row--selected' : ''}${isSplit ? ' plan-row--split' : ''}`}
      style={{
        padding: '10px 8px',
        borderRadius: '7px',
        background: selected ? 'var(--active)' : isSplit ? 'var(--hover)' : 'transparent',
        cursor: 'pointer',
        border: isSplit ? '1px dashed var(--border)' : 'none',
        fontFamily: 'inherit',
      }}
    >
      <div
        ref={titleRef}
        className={`plan-title${overflows ? ' plan-title--fade' : ''}`}
        style={{ paddingLeft: unseen ? '14px' : undefined }}
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

export function PlanList({
  plans,
  selectedId,
  splitPlanId,
  onSelect,
  onOpenInSplitView,
  isPro = false,
}: {
  plans: Plan[];
  selectedId: string | undefined;
  splitPlanId?: string;
  onSelect: (plan: Plan) => void;
  onOpenInSplitView?: (plan: Plan) => void;
  isPro?: boolean;
}) {
  const { isUnseen, markSeen, markAllSeen } = useSeenPlans();
  const [contextMenu, setContextMenu] = useState<{ plan: Plan; x: number; y: number } | null>(null);

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

  if (plans.length === 0) {
    return (
      <div className="p-4" style={{ fontSize: '13px', color: 'var(--tertiary)' }}>
        No plans found
      </div>
    );
  }

  function handleClick(plan: Plan) {
    if (isPro) markSeen(plan.id, plan.updatedAt);
    onSelect(plan);
  }

  return (
    <div style={{ width: '100%' }}>
      {unseenPlans.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px 4px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#3b82f6',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Updated ({unseenPlans.length})
            </span>
            <button
              type="button"
              onClick={() => markAllSeen(unseenPlans)}
              style={{
                fontSize: '11px',
                color: 'var(--tertiary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
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
              isSplit={plan.id === splitPlanId}
              onClick={() => handleClick(plan)}
              onContextMenu={(e) => handleContextMenu(e, plan)}
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
      {restPlans.map((plan) => (
        <PlanRow
          key={plan.id}
          plan={plan}
          selected={plan.id === selectedId}
          unseen={false}
          isSplit={plan.id === splitPlanId}
          onClick={() => handleClick(plan)}
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
              disabled={contextMenu.plan.id === selectedId || contextMenu.plan.id === splitPlanId}
              onClick={() => {
                if (isPro) markSeen(contextMenu.plan.id, contextMenu.plan.updatedAt);
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
                color:
                  contextMenu.plan.id === selectedId || contextMenu.plan.id === splitPlanId
                    ? 'var(--tertiary)'
                    : 'var(--text)',
                cursor:
                  contextMenu.plan.id === selectedId || contextMenu.plan.id === splitPlanId
                    ? 'not-allowed'
                    : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                if (contextMenu.plan.id !== selectedId && contextMenu.plan.id !== splitPlanId) {
                  e.currentTarget.style.background = 'var(--hover)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <SplitViewIcon />
              Open in Split View
            </button>
          </div>,
          document.body,
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
      style={{ width: '14px', height: '14px', flexShrink: 0 }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 4.5v15m6-15v15M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z"
      />
    </svg>
  );
}
