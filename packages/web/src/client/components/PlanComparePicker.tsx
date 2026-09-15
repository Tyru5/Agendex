import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { filterPlans } from '../lib/plan-search.ts';
import { AgentIcon } from './AgentIcon.tsx';

const PICKER_RESULT_LIMIT = 50;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type PickerGroup = {
  label: string;
  plans: Plan[];
};

export type PlanComparePickerProps = {
  open: boolean;
  onClose: () => void;
  /** Plan the comparison starts from; excluded from the list. */
  currentPlan: Plan;
  /** Full candidate pool. */
  plans: readonly Plan[];
  /** Session/lineage siblings surfaced first. */
  relatedPlans?: readonly Plan[];
  onPick: (plan: Plan) => void;
};

export function PlanComparePicker({
  open,
  onClose,
  currentPlan,
  plans,
  relatedPlans,
  onPick,
}: PlanComparePickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const groups = useMemo((): PickerGroup[] => {
    if (!open) return [];
    const relatedIds = new Set((relatedPlans ?? []).map((plan) => plan.id));
    const related = filterPlans(
      (relatedPlans ?? []).filter((plan) => plan.id !== currentPlan.id),
      query,
    );
    const rest = filterPlans(
      plans.filter((plan) => plan.id !== currentPlan.id && !relatedIds.has(plan.id)),
      query,
    )
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, PICKER_RESULT_LIMIT);

    const result: PickerGroup[] = [];
    if (related.length > 0) result.push({ label: 'Related plans', plans: related });
    if (rest.length > 0) result.push({ label: 'All plans', plans: rest });
    return result;
  }, [currentPlan.id, open, plans, query, relatedPlans]);

  const flatPlans = useMemo(() => groups.flatMap((group) => group.plans), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, flatPlans.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const plan = flatPlans[activeIndex];
      if (plan) onPick(plan);
    }
  }

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'color-mix(in oklch, var(--bg) 62%, transparent)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="plan-compare-picker rounded-xl border border-border bg-surface shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a plan to compare"
      >
        <div className="plan-compare-picker-search">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Compare with…"
            aria-label="Search plans to compare"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="plan-compare-picker-list" ref={listRef}>
          {flatPlans.length === 0 && (
            <p className="plan-compare-picker-empty">No matching plans.</p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="plan-compare-picker-group">
              <span className="plan-compare-picker-group-label">{group.label}</span>
              {group.plans.map((plan) => {
                flatIndex++;
                const isActive = flatIndex === activeIndex;
                const index = flatIndex;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    className="plan-compare-picker-item"
                    data-active={isActive ? 'true' : undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onPick(plan)}
                  >
                    <AgentIcon agent={plan.agent} size={13} />
                    <span className="plan-compare-picker-item-title" title={plan.title}>
                      {plan.title}
                    </span>
                    <span className="plan-compare-picker-item-meta">
                      {plan.workspace && (
                        <span className="plan-compare-picker-item-workspace">{plan.workspace}</span>
                      )}
                      <span>{getAgentLabel(plan.agent)}</span>
                      <span>{timeAgo(plan.updatedAt)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.7}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
      />
    </svg>
  );
}
