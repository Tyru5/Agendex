import { useMemo, useState } from 'react';
import {
  buildDiffSegments,
  computeDiffLines,
  formatHunkHeader,
  hasDiffChanges,
  type DiffLine,
  type DiffSegment,
} from '../lib/planDiff.ts';

const prefixes: Record<DiffLine['type'], string> = {
  added: '+',
  removed: '-',
  unchanged: ' ',
};

function lineBackground(type: DiffLine['type']): string | undefined {
  switch (type) {
    case 'added':
      return 'color-mix(in oklch, var(--success) 12%, transparent)';
    case 'removed':
      return 'color-mix(in oklch, var(--danger) 12%, transparent)';
    default:
      return undefined;
  }
}

function lineColor(type: DiffLine['type']): string {
  switch (type) {
    case 'added':
      return 'var(--success)';
    case 'removed':
      return 'var(--danger)';
    default:
      return 'var(--text)';
  }
}

function DiffCodeLine({ line }: { line: DiffLine }) {
  return (
    <div
      className="grid grid-cols-[minmax(2.5rem,auto)_minmax(2.5rem,auto)_1rem_minmax(0,1fr)] gap-0 whitespace-pre-wrap break-words"
      style={{
        background: lineBackground(line.type),
        color: lineColor(line.type),
        textDecoration: line.type === 'removed' ? 'line-through' : undefined,
        textDecorationColor:
          line.type === 'removed'
            ? 'color-mix(in oklch, var(--danger) 34%, transparent)'
            : undefined,
      }}
    >
      <span className="select-none px-2 text-right text-[11px] text-tertiary tabular-nums opacity-70 border-r border-[rgba(128,128,128,0.1)]">
        {line.oldLineNumber ?? ''}
      </span>
      <span className="select-none px-2 text-right text-[11px] text-tertiary tabular-nums opacity-70 border-r border-[rgba(128,128,128,0.1)]">
        {line.newLineNumber ?? ''}
      </span>
      <span className="select-none text-center opacity-60">{prefixes[line.type]}</span>
      <span className="pr-3 pl-1">{line.content || '\u00A0'}</span>
    </div>
  );
}

function CollapsedSegment({
  lines,
  expanded,
  onToggle,
}: {
  lines: DiffLine[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (expanded) {
    return (
      <div>
        <button
          type="button"
          onClick={onToggle}
          className="w-full py-1.5 px-3 text-left text-[11.5px] font-[450] font-[inherit] border-0 border-y border-[rgba(128,128,128,0.1)] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] text-[var(--accent)] cursor-pointer"
        >
          Collapse {lines.length} unchanged {lines.length === 1 ? 'line' : 'lines'}
        </button>
        {lines.map((line, idx) => (
          <DiffCodeLine
            key={`exp-${line.oldLineNumber}-${line.newLineNumber}-${idx}`}
            line={line}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full py-1.5 px-3 text-left text-[11.5px] font-[450] font-[inherit] border-0 border-y border-[rgba(128,128,128,0.1)] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] text-[var(--accent)] cursor-pointer hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]"
    >
      ⋮ Expand {lines.length} unchanged {lines.length === 1 ? 'line' : 'lines'}
    </button>
  );
}

function DiffSegmentView({
  segment,
  index,
  expanded,
  onToggle,
}: {
  segment: DiffSegment;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (segment.kind === 'collapsed') {
    return <CollapsedSegment lines={segment.lines} expanded={expanded} onToggle={onToggle} />;
  }

  return (
    <div>
      <div className="px-3 py-1 text-[11.5px] font-[550] text-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] border-y border-[rgba(128,128,128,0.08)] select-none">
        {formatHunkHeader(segment.hunk)}
      </div>
      {segment.hunk.lines.map((line, idx) => (
        <DiffCodeLine
          key={`h${index}-${line.type}-${line.oldLineNumber}-${line.newLineNumber}-${idx}`}
          line={line}
        />
      ))}
    </div>
  );
}

export function PlanDiffViewer({
  oldContent,
  newContent,
  oldLabel = 'a/plan',
  newLabel = 'b/plan',
  oldTitle,
  newTitle,
}: {
  oldContent: string;
  newContent: string;
  oldLabel?: string;
  newLabel?: string;
  oldTitle?: string;
  newTitle?: string;
}) {
  const lines = useMemo(() => computeDiffLines(oldContent, newContent), [oldContent, newContent]);
  const segments = useMemo(() => buildDiffSegments(lines), [lines]);
  const [expandedCollapsed, setExpandedCollapsed] = useState<Record<number, boolean>>({});

  const titleChanged = oldTitle != null && newTitle != null && oldTitle !== newTitle;
  const changed = hasDiffChanges(lines) || titleChanged;

  if (!changed) {
    return (
      <div className="p-5 text-[12.5px] text-tertiary text-center border border-border rounded-lg">
        No differences between these versions.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden text-[12.5px] font-[var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] leading-[1.6]">
      <div className="px-3 py-2.5 border-b border-border bg-[color-mix(in_oklch,var(--hover)_65%,transparent)]">
        <div className="text-[11.5px] text-tertiary select-none">
          diff --git {oldLabel} {newLabel}
        </div>
        <div className="mt-0.5 text-[12px] text-secondary">
          <span className="text-[var(--danger)]">--- {oldLabel}</span>
          <span className="mx-2 text-tertiary">→</span>
          <span className="text-[var(--success)]">+++ {newLabel}</span>
        </div>
      </div>

      {titleChanged && (
        <div className="border-b border-border">
          <div className="px-3 py-1 text-[11.5px] font-[550] text-secondary bg-hover select-none">
            title
          </div>
          <DiffCodeLine
            line={{
              type: 'removed',
              content: oldTitle,
              oldLineNumber: 1,
              newLineNumber: null,
            }}
          />
          <DiffCodeLine
            line={{
              type: 'added',
              content: newTitle,
              oldLineNumber: null,
              newLineNumber: 1,
            }}
          />
        </div>
      )}

      {hasDiffChanges(lines) ? (
        segments.map((segment, index) => (
          <DiffSegmentView
            key={`seg-${index}`}
            segment={segment}
            index={index}
            expanded={expandedCollapsed[index] === true}
            onToggle={() =>
              setExpandedCollapsed((prev) => ({
                ...prev,
                [index]: !prev[index],
              }))
            }
          />
        ))
      ) : (
        <div className="p-4 text-[12.5px] text-tertiary text-center">
          Plan body unchanged (title differs).
        </div>
      )}
    </div>
  );
}
