import type { PlanReadResult } from '@agendex/shared/plan-read';
import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import type { Plan } from '../lib/api.ts';
import { canReadPlan, PlanReadContext } from '../lib/plan-read-context.tsx';
import {
  requestPlanRead,
  readRevisionKey,
  readVisitKey,
  readSummary,
} from '../lib/plan-read-session.ts';
const ReadDiff = lazy(() =>
  import('./PlanReadDiff.tsx').then((m) => ({ default: m.PlanReadDiff })),
);

type PlanReadOpening = {
  key: string;
  revisionKey: string;
  request: Promise<PlanReadResult>;
  plan: Plan;
  status: 'pending' | 'fulfilled';
  cleared?: boolean;
};

type FailedPlanReadOpening = { key: string; revisionKey: string };

export function shouldRequestPlanRead(
  opening: Pick<PlanReadOpening, 'key'> | undefined,
  failed: FailedPlanReadOpening | undefined,
  key: string,
  revisionKey: string,
): boolean {
  return opening?.key !== key && (failed?.key !== key || failed.revisionKey !== revisionKey);
}

export function PlanReadSection({ plan }: { plan: Plan }) {
  const source = useContext(PlanReadContext);
  const eligible = canReadPlan(source, plan);
  const key = readVisitKey(source?.scope, plan);
  const revisionKey = readRevisionKey(source?.scope, plan);
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const opening = useRef<PlanReadOpening | undefined>(undefined);
  const failedOpening = useRef<FailedPlanReadOpening | undefined>(undefined);
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<{
    key: string;
    result?: PlanReadResult;
    plan?: Plan;
    error?: string;
    cleared?: boolean;
  }>();
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!source || !eligible) {
      opening.current = undefined;
      failedOpening.current = undefined;
      return;
    }
    if (opening.current?.key !== key) opening.current = undefined;
    if (failedOpening.current?.key !== key) failedOpening.current = undefined;
    if (shouldRequestPlanRead(opening.current, failedOpening.current, key, revisionKey)) {
      const displayed = planRef.current;
      const openedRevisionKey = readRevisionKey(source.scope, displayed);
      const request = requestPlanRead(openedRevisionKey, source, displayed);
      if (!request) return;
      opening.current = {
        key,
        revisionKey: openedRevisionKey,
        request,
        plan: displayed,
        status: 'pending',
      };
    }
    const currentOpening = opening.current;
    if (!currentOpening || currentOpening.cleared || currentOpening.status === 'fulfilled') return;
    const { request, plan: openedPlan, revisionKey: openedRevisionKey } = currentOpening;
    let active = true;
    void request.then(
      (result) => {
        if (!active || opening.current !== currentOpening) return;
        currentOpening.status = 'fulfilled';
        failedOpening.current = undefined;
        setState({ key, result, plan: openedPlan });
      },
      (error) => {
        if (!active || opening.current !== currentOpening) return;
        opening.current = undefined;
        failedOpening.current = { key, revisionKey: openedRevisionKey };
        setState({
          key,
          error: error instanceof Error ? error.message : 'Could not load the remembered revision.',
        });
        const refreshedRevisionKey = readRevisionKey(source.scope, planRef.current);
        if (refreshedRevisionKey !== openedRevisionKey) {
          setRetryVersion((version) => version + 1);
        }
      },
    );
    return () => {
      active = false;
    };
    // Keep the first successful revision and comparison for this source visit.
  }, [key, source, eligible, plan.contentLoaded, revisionKey, retryVersion]);
  if (!eligible) return null;
  const current = state?.key === key ? state : undefined;
  const baseline = current?.result?.baseline;
  const displayed = current?.plan ?? plan;
  const changed =
    baseline && (baseline.title !== displayed.title || baseline.content !== displayed.content);
  async function clear() {
    if (!source || !canReadPlan(source, plan)) return;
    setClearing(true);
    try {
      await source.clear(plan);
      if (opening.current?.key === key) opening.current.cleared = true;
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
                ? readSummary(current.result, displayed)
                : 'Loading the remembered revision…'))}
        </p>
        {expanded && changed && baseline && (
          <Suspense fallback={<p>Preparing comparison…</p>}>
            <ReadDiff baseline={baseline} current={displayed} />
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
