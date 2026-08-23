import { Fragment, useEffect, useMemo, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import {
  buildDiffSections,
  type DiffBlock,
  type DiffDisplaySection,
  type DiffLine,
  type DiffWordSegment,
  diffPlanContent,
} from '../lib/plan-diff.ts';
import { AgentIcon } from './AgentIcon.tsx';

const COMPARE_VIEW_PREF_KEY = 'agendex_compare_view';

type CompareViewMode = 'split' | 'unified';

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

function initialViewMode(): CompareViewMode {
  try {
    const stored = localStorage.getItem(COMPARE_VIEW_PREF_KEY);
    if (stored === 'split' || stored === 'unified') return stored;
  } catch {
    // Ignore storage failures; fall through to the width heuristic.
  }
  if (typeof window !== 'undefined' && window.innerWidth < 900) return 'unified';
  return 'split';
}

function renderSegments(segments: DiffWordSegment[]) {
  // Segments are stable per line render; a char-offset key is unique and
  // avoids index-key churn warnings.
  let offset = 0;
  return segments.map((segment) => {
    const key = `${offset}:${segment.type}`;
    offset += segment.text.length;
    return segment.type === 'same' ? (
      <Fragment key={key}>{segment.text}</Fragment>
    ) : (
      <mark
        key={key}
        className={
          segment.type === 'add'
            ? 'plan-diff-word plan-diff-word--add'
            : 'plan-diff-word plan-diff-word--del'
        }
      >
        {segment.text}
      </mark>
    );
  });
}

function lineContent(line: DiffLine) {
  if (line.segments) return renderSegments(line.segments);
  return line.text;
}

/** Non-breaking space keeps empty diff lines at full row height. */
function textOrSpace(text: string) {
  return text.length > 0 ? text : ' ';
}

function UnifiedBlock({ block }: { block: DiffBlock }) {
  if (block.type === 'same') {
    return (
      <>
        {block.lines.map((line) => (
          <div key={`s-${line.aLine}-${line.bLine}`} className="plan-diff-row">
            <span className="plan-diff-gutter">{line.aLine}</span>
            <span className="plan-diff-gutter">{line.bLine}</span>
            <span className="plan-diff-sign" aria-hidden="true" />
            <span className="plan-diff-text">{textOrSpace(line.text)}</span>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {block.removed.map((line) => (
        <div key={`d-${line.line}`} className="plan-diff-row plan-diff-row--del">
          <span className="plan-diff-gutter">{line.line}</span>
          <span className="plan-diff-gutter" />
          <span className="plan-diff-sign" aria-hidden="true">
            −
          </span>
          <span className="plan-diff-text">{line.text.length > 0 ? lineContent(line) : ' '}</span>
        </div>
      ))}
      {block.added.map((line) => (
        <div key={`a-${line.line}`} className="plan-diff-row plan-diff-row--add">
          <span className="plan-diff-gutter" />
          <span className="plan-diff-gutter">{line.line}</span>
          <span className="plan-diff-sign" aria-hidden="true">
            +
          </span>
          <span className="plan-diff-text">{line.text.length > 0 ? lineContent(line) : ' '}</span>
        </div>
      ))}
    </>
  );
}

function SplitBlock({ block }: { block: DiffBlock }) {
  if (block.type === 'same') {
    return (
      <>
        {block.lines.map((line) => (
          <div key={`s-${line.aLine}-${line.bLine}`} className="plan-diff-split-row">
            <span className="plan-diff-gutter">{line.aLine}</span>
            <span className="plan-diff-text">{textOrSpace(line.text)}</span>
            <span className="plan-diff-gutter">{line.bLine}</span>
            <span className="plan-diff-text">{textOrSpace(line.text)}</span>
          </div>
        ))}
      </>
    );
  }

  const rowCount = Math.max(block.removed.length, block.added.length);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const removed = block.removed[i];
    const added = block.added[i];
    rows.push(
      <div key={`c-${removed?.line ?? 'x'}-${added?.line ?? 'x'}`} className="plan-diff-split-row">
        <span className={removed ? 'plan-diff-gutter plan-diff-gutter--del' : 'plan-diff-gutter'}>
          {removed?.line ?? ''}
        </span>
        <span
          className={
            removed ? 'plan-diff-text plan-diff-text--del' : 'plan-diff-text plan-diff-text--empty'
          }
        >
          {removed ? (removed.text.length > 0 ? lineContent(removed) : ' ') : ' '}
        </span>
        <span className={added ? 'plan-diff-gutter plan-diff-gutter--add' : 'plan-diff-gutter'}>
          {added?.line ?? ''}
        </span>
        <span
          className={
            added ? 'plan-diff-text plan-diff-text--add' : 'plan-diff-text plan-diff-text--empty'
          }
        >
          {added ? (added.text.length > 0 ? lineContent(added) : ' ') : ' '}
        </span>
      </div>,
    );
  }
  return <>{rows}</>;
}

function CollapsedSection({
  section,
  mode,
  onExpand,
}: {
  section: Extract<DiffDisplaySection, { type: 'collapsed' }>;
  mode: CompareViewMode;
  onExpand: () => void;
}) {
  const label = `Show ${section.lines.length} unchanged line${section.lines.length !== 1 ? 's' : ''}`;
  return (
    <button
      type="button"
      className={
        mode === 'split' ? 'plan-diff-collapsed plan-diff-collapsed--split' : 'plan-diff-collapsed'
      }
      onClick={onExpand}
    >
      <ExpandIcon />
      {label}
    </button>
  );
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
  const [viewMode, setViewMode] = useState<CompareViewMode>(initialViewMode);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setExpandedKeys(new Set());
  }, [basePlan.id, targetPlan.id]);

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
  const sections = useMemo(() => buildDiffSections(diff.blocks), [diff.blocks]);

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
        <div
          className={
            viewMode === 'split' ? 'plan-diff plan-diff--split' : 'plan-diff plan-diff--unified'
          }
        >
          {sections.map((section, index) => {
            if (section.type === 'collapsed' && !expandedKeys.has(section.key)) {
              return (
                <CollapsedSection
                  key={section.key}
                  section={section}
                  mode={viewMode}
                  onExpand={() =>
                    setExpandedKeys((current) => {
                      const next = new Set(current);
                      next.add(section.key);
                      return next;
                    })
                  }
                />
              );
            }
            const block: DiffBlock =
              section.type === 'collapsed' ? { type: 'same', lines: section.lines } : section.block;
            const key = section.type === 'collapsed' ? `${section.key}-expanded` : `block-${index}`;
            return viewMode === 'split' ? (
              <SplitBlock key={key} block={block} />
            ) : (
              <UnifiedBlock key={key} block={block} />
            );
          })}
        </div>
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

function ExpandIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className="w-[12px] h-[12px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m7 9 5-5 5 5M7 15l5 5 5-5" />
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
