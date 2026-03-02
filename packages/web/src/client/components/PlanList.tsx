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
      className={`w-full text-left block plan-row${selected ? ' plan-row--selected' : ''} py-2.5 px-2 rounded-[7px] cursor-pointer border-none font-[inherit]`}
      style={{ background: selected ? 'var(--active)' : 'transparent' }}
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
        />
      ))}
    </div>
  );
}
