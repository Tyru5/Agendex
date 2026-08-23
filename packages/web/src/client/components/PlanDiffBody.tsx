import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  buildDiffSections,
  type DiffBlock,
  type DiffDisplaySection,
  type DiffLine,
  type DiffWordSegment,
  type PlanDiff,
} from '../lib/plan-diff.ts';

export type PlanDiffLayout = 'split' | 'unified';

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
  return text.length > 0 ? text : ' ';
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
          <span className="plan-diff-text">{line.text.length > 0 ? lineContent(line) : ' '}</span>
        </div>
      ))}
      {block.added.map((line) => (
        <div key={`a-${line.line}`} className="plan-diff-row plan-diff-row--add">
          <span className="plan-diff-gutter" />
          <span className="plan-diff-gutter">{line.line}</span>
          <span className="plan-diff-sign" aria-hidden="true">
            +
          </span>
          <span className="plan-diff-text">{line.text.length > 0 ? lineContent(line) : ' '}</span>
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
          {removed ? (removed.text.length > 0 ? lineContent(removed) : ' ') : ' '}
        </span>
        <span className={added ? 'plan-diff-gutter plan-diff-gutter--add' : 'plan-diff-gutter'}>
          {added?.line ?? ''}
        </span>
        <span
          className={
            added ? 'plan-diff-text plan-diff-text--add' : 'plan-diff-text plan-diff-text--empty'
          }
        >
          {added ? (added.text.length > 0 ? lineContent(added) : ' ') : ' '}
        </span>
      </div>,
    );
  }
  return <>{rows}</>;
}

function CollapsedSection({
  section,
  onExpand,
}: {
  section: Extract<DiffDisplaySection, { type: 'collapsed' }>;
  onExpand: () => void;
}) {
  const label = `Show ${section.lines.length} unchanged line${section.lines.length !== 1 ? 's' : ''}`;
  return (
    <button type="button" className="plan-diff-collapsed" onClick={onExpand}>
      <ExpandIcon />
      {label}
    </button>
  );
}

export type PlanDiffBodyProps = {
  diff: PlanDiff;
  layout: PlanDiffLayout;
  /** Appended to the `.plan-diff` container (e.g. `plan-diff--embedded`). */
  className?: string;
};

/**
 * Renders computed diff blocks as split or unified rows with collapsible
 * unchanged runs. Owns the expand state, which resets when `diff` changes.
 */
export function PlanDiffBody({ diff, layout, className }: PlanDiffBodyProps) {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setExpandedKeys(new Set());
  }, [diff]);

  const sections = useMemo(() => buildDiffSections(diff.blocks), [diff.blocks]);

  const containerClass = [
    'plan-diff',
    layout === 'split' ? 'plan-diff--split' : 'plan-diff--unified',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass}>
      {sections.map((section, index) => {
        if (section.type === 'collapsed' && !expandedKeys.has(section.key)) {
          return (
            <CollapsedSection
              key={section.key}
              section={section}
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
        return layout === 'split' ? (
          <SplitBlock key={key} block={block} />
        ) : (
          <UnifiedBlock key={key} block={block} />
        );
      })}
    </div>
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
