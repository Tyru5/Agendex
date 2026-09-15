import { useEffect, useMemo, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { diffPlanContent } from '../lib/plan-diff.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { PlanDiffBody, type PlanDiffLayout } from './PlanDiffBody.tsx';

const COMPARE_VIEW_PREF_KEY = 'agendex_compare_view';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function initialViewMode(): PlanDiffLayout {
  try {
    const stored = localStorage.getItem(COMPARE_VIEW_PREF_KEY);
    if (stored === 'split' || stored === 'unified') return stored;
  } catch {
    // Ignore storage failures; fall through to the width heuristic.
  }
  if (typeof window !== 'undefined' && window.innerWidth < 900) return 'unified';
  return 'split';
}

type ComparePlanCardProps = {
  plan: Plan;
  side: 'base' | 'target';
  onOpen?: (plan: Plan) => void;
};

function ComparePlanCard({ plan, side, onOpen }: ComparePlanCardProps) {
  const body = (
    <>
      <span className="plan-compare-card-role">{side === 'base' ? 'Base' : 'Comparing'}</span>
      <span className="plan-compare-card-title" title={plan.title}>
        {plan.title}
      </span>
      <span className="plan-compare-card-meta">
        <AgentIcon agent={plan.agent} size={12} />
        <span>{getAgentLabel(plan.agent)}</span>
        {plan.workspace && <span className="plan-compare-card-workspace">{plan.workspace}</span>}
        <span className="plan-compare-card-time">Updated {timeAgo(plan.updatedAt)}</span>
      </span>
    </>
  );

  if (!onOpen) {
    return <div className={`plan-compare-card plan-compare-card--${side}`}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={`plan-compare-card plan-compare-card--${side} plan-compare-card--button`}
      onClick={() => onOpen(plan)}
      title="Open this plan"
    >
      {body}
    </button>
  );
}

export type PlanCompareViewProps = {
  /** Older / reference side, rendered on the left. */
  basePlan: Plan;
  /** Newer / current side, rendered on the right. */
  targetPlan: Plan;
  onClose: () => void;
  onSwap: () => void;
  /** Opens one side in the regular plan viewer. */
  onOpenPlan?: (plan: Plan) => void;
};

export function PlanCompareView({
  basePlan,
  targetPlan,
  onClose,
  onSwap,
  onOpenPlan,
}: PlanCompareViewProps) {
  const [viewMode, setViewMode] = useState<PlanDiffLayout>(initialViewMode);

  useEffect(() => {
    try {
      localStorage.setItem(COMPARE_VIEW_PREF_KEY, viewMode);
    } catch {
      // Preference persistence is best-effort.
    }
  }, [viewMode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const diff = useMemo(
    () => diffPlanContent(basePlan.content, targetPlan.content),
    [basePlan.content, targetPlan.content],
  );

  const similarityPercent = Math.round(diff.stats.similarity * 100);

  return (
    <div className="plan-compare" aria-label="Plan comparison">
      <header className="plan-compare-header">
        <div className="plan-compare-header-top">
          <span className="plan-compare-title">
            <CompareIcon />
            Compare plans
          </span>
          <button
            type="button"
            className="plan-compare-close"
            onClick={onClose}
            aria-label="Close comparison"
            title="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="plan-compare-cards">
          <ComparePlanCard plan={basePlan} side="base" onOpen={onOpenPlan} />
          <button
            type="button"
            className="plan-compare-swap"
            onClick={onSwap}
            aria-label="Swap sides"
            title="Swap sides"
          >
            <SwapIcon />
          </button>
          <ComparePlanCard plan={targetPlan} side="target" onOpen={onOpenPlan} />
        </div>

        <div className="plan-compare-toolbar">
          <div className="plan-compare-stats" aria-label="Difference summary">
            {diff.identical ? (
              <span className="plan-compare-stat plan-compare-stat--identical">
                Content identical
              </span>
            ) : (
              <>
                <span className="plan-compare-stat plan-compare-stat--add">
                  +{diff.stats.added}
                </span>
                <span className="plan-compare-stat plan-compare-stat--del">
                  −{diff.stats.removed}
                </span>
                <span className="plan-compare-stat plan-compare-stat--similarity">
                  {similarityPercent}% unchanged
                </span>
              </>
            )}
          </div>

          <div className="plan-compare-modes" role="group" aria-label="Diff layout">
            <button
              type="button"
              className="plan-compare-mode"
              aria-pressed={viewMode === 'split'}
              onClick={() => setViewMode('split')}
            >
              Split
            </button>
            <button
              type="button"
              className="plan-compare-mode"
              aria-pressed={viewMode === 'unified'}
              onClick={() => setViewMode('unified')}
            >
              Unified
            </button>
          </div>
        </div>
      </header>

      {diff.identical ? (
        <div className="plan-compare-identical" role="status">
          <CheckCircleIcon />
          <p>These plans have identical content.</p>
          <span>
            {basePlan.id === targetPlan.id
              ? 'You are comparing a plan with itself.'
              : 'Every line matches, though titles, timestamps, or sources may differ.'}
          </span>
        </div>
      ) : (
        <PlanDiffBody diff={diff} layout={viewMode} />
      )}
    </div>
  );
}

export function CompareIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 8.6v4.15A3.25 3.25 0 0 0 9.25 16H13"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 15.4V11.2A3.25 3.25 0 0 0 14.75 8H11"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="m13.2 13.8 2.2 2.2-2.2 2.2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10.8 5.8-2.2 2.2 2.2 2.2" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h13m0 0-3.2-3.2M17 8l-3.2 3.2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 16H7m0 0 3.2-3.2M7 16l3.2 3.2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.4}
      stroke="currentColor"
      className="w-[28px] h-[28px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}
