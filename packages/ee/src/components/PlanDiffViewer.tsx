import { diffPlanContent, PlanDiffBody } from '@agendex/web';
import { useMemo } from 'react';

/**
 * Version-to-version diff for the plan history drawer, rendered with the
 * shared plan diff engine (patience line diff + word-level highlights).
 */
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
  const diff = useMemo(() => diffPlanContent(oldContent, newContent), [oldContent, newContent]);

  const titleChanged = oldTitle != null && newTitle != null && oldTitle !== newTitle;
  const changed = !diff.identical || titleChanged;

  if (!changed) {
    return (
      <div className="p-5 text-[12.5px] text-tertiary text-center border border-border rounded-lg">
        No differences between these versions.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden text-[12.5px] leading-[1.6]">
      <div className="px-3 py-2.5 border-b border-border bg-[color-mix(in_oklch,var(--hover)_65%,transparent)] font-[family-name:var(--font-mono)]">
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
        <div className="border-b border-border font-[family-name:var(--font-mono)]">
          <div className="px-3 py-1 text-[11.5px] font-[550] text-secondary bg-hover select-none">
            title
          </div>
          <div className="plan-diff-row plan-diff-row--del">
            <span className="plan-diff-gutter">1</span>
            <span className="plan-diff-gutter" />
            <span className="plan-diff-sign" aria-hidden="true">
              −
            </span>
            <span className="plan-diff-text">{oldTitle}</span>
          </div>
          <div className="plan-diff-row plan-diff-row--add">
            <span className="plan-diff-gutter" />
            <span className="plan-diff-gutter">1</span>
            <span className="plan-diff-sign" aria-hidden="true">
              +
            </span>
            <span className="plan-diff-text">{newTitle}</span>
          </div>
        </div>
      )}

      {diff.identical ? (
        <div className="p-4 text-[12.5px] text-tertiary text-center">
          Plan body unchanged (title differs).
        </div>
      ) : (
        <PlanDiffBody diff={diff} layout="unified" className="plan-diff--embedded" />
      )}
    </div>
  );
}
