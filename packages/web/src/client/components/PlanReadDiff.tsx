import type { PlanReadSnapshot } from '@agendex/shared/plan-read';
import { useMemo } from 'react';
import { diffPlanContent } from '../lib/plan-diff.ts';
import { PlanDiffBody } from './PlanDiffBody.tsx';
export function PlanReadDiff({
  baseline,
  current,
}: {
  baseline: PlanReadSnapshot;
  current: PlanReadSnapshot;
}) {
  const diff = useMemo(
    () => diffPlanContent(baseline.content, current.content),
    [baseline.content, current.content],
  );
  return (
    <>
      {baseline.title !== current.title && (
        <p>
          Title: <del>{baseline.title}</del> → <ins>{current.title}</ins>
        </p>
      )}
      <p>
        {diff.stats.added} lines added · {diff.stats.removed} lines removed. Removed lines use −;
        added lines use +.
      </p>
      <PlanDiffBody diff={diff} layout="unified" className="plan-diff--embedded" />
    </>
  );
}
