import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
}: {
  plan: Plan;
  selected: boolean;
  unseen: boolean;
  onClick: () => void;
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
      className={`w-full text-left block plan-row${selected ? ' plan-row--selected' : ''}`}
      style={{
        padding: '10px 8px',
        borderRadius: '7px',
        background: selected ? 'var(--active)' : 'transparent',
        cursor: 'pointer',
        border: 'none',
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
  onSelect,
  isPro = false,
}: {
  plans: Plan[];
  selectedId: string | undefined;
  onSelect: (plan: Plan) => void;
  isPro?: boolean;
}) {
  const { isUnseen, markSeen, markAllSeen } = useSeenPlans();

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
              onClick={() => handleClick(plan)}
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
          onClick={() => handleClick(plan)}
        />
      ))}
    </div>
  );
}
