import type { PlanReadResult } from '@agendex/shared/plan-read';
import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import type { Plan } from '../lib/api.ts';
import { PlanReadContext, type PlanReadSource } from '../lib/plan-read-context.tsx';
const ReadDiff = lazy(() =>
  import('./PlanReadDiff.tsx').then((m) => ({ default: m.PlanReadDiff })),
);
// Coalesce StrictMode's simultaneous effects, but never replay a settled read on a later opening.
const pending = new Map<string, Promise<PlanReadResult>>();
function openOnce(key: string, source: PlanReadSource, plan: Plan): Promise<PlanReadResult> {
  const existing = pending.get(key);
  if (existing) return existing;
  const result = source.open(plan);
  pending.set(key, result);
  const done = () => {
    if (pending.get(key) === result) pending.delete(key);
  };
  void result.then(done, done);
  return result;
}
export function readSummary(result: PlanReadResult, plan: Pick<Plan, 'title' | 'content'>): string {
  if (result.reason === 'too-large')
    return 'This plan is too large to remember for read comparisons.';
  if (result.reason === 'unavailable')
    return 'The previously read snapshot is no longer available. This revision is now remembered.';
  if (!result.baseline)
    return 'No earlier read snapshot. This revision is now remembered for your next visit.';
  return result.baseline.title !== plan.title || result.baseline.content !== plan.content
    ? 'Changes available since your previous read.'
    : 'Title and content are unchanged since your previous read.';
}
/** Pending requests and effect results must follow the same source boundary as storage. */
export function readRevisionKey(scope: string | undefined, plan: Plan): string {
  return JSON.stringify([
    scope,
    plan.ownerId,
    plan.id,
    plan.agent,
    plan.filePath,
    plan.workspace,
    plan.updatedAt,
    plan.title,
    plan.content,
  ]);
}
export function PlanReadSection({ plan }: { plan: Plan }) {
  const source = useContext(PlanReadContext);
  const key = readRevisionKey(source?.scope, plan);
  const planRef = useRef(plan);
  planRef.current = plan;
  const [state, setState] = useState<{
    key: string;
    result?: PlanReadResult;
    error?: string;
    cleared?: boolean;
  }>();
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!source || plan.contentLoaded === false) return;
    let active = true;
    void openOnce(key, source, planRef.current).then(
      (result) => {
        if (active) setState({ key, result });
      },
      (error) => {
        if (active)
          setState({
            key,
            error:
              error instanceof Error ? error.message : 'Could not load the remembered revision.',
          });
      },
    );
    return () => {
      active = false;
    };
    // The key includes every displayed revision field, while providers keep their callbacks stable.
  }, [key, source, plan.contentLoaded]);
  if (!source) return null;
  const current = state?.key === key ? state : undefined;
  const baseline = current?.result?.baseline;
  const changed = baseline && (baseline.title !== plan.title || baseline.content !== plan.content);
  async function clear() {
    if (!source) return;
    setClearing(true);
    try {
      await source.clear(plan);
      setState({ key, cleared: true });
    } catch (error) {
      setState({
        key,
        error: error instanceof Error ? error.message : 'Could not forget the remembered revision.',
      });
    } finally {
      setClearing(false);
    }
  }
  return (
    <details
      className="plan-read-section"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Changes since last read{changed ? ' · changed' : ''}</summary>
      <div className="plan-read-section-body" aria-live="polite">
        <p>
          {current?.cleared
            ? 'Remembered revision cleared. Your next visit starts a new baseline.'
            : (current?.error ??
              (current?.result
                ? readSummary(current.result, plan)
                : 'Loading the remembered revision…'))}
        </p>
        {expanded && changed && baseline && (
          <Suspense fallback={<p>Preparing comparison…</p>}>
            <ReadDiff baseline={baseline} current={plan} />
          </Suspense>
        )}
        {current?.result && current.result.reason !== 'too-large' && (
          <button type="button" onClick={() => void clear()} disabled={clearing}>
            {clearing ? 'Forgetting…' : 'Forget remembered revision'}
          </button>
        )}
      </div>
    </details>
  );
}
