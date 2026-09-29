import type { HiddenPlanSummary, PlanCheck } from '@agendex/shared/plan-check';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Plan } from '../lib/api.ts';
import { PlanCheckSection } from './PlanCheckSection.tsx';

const REASONS: Record<string, string> = {
  'empty-content': 'No readable content',
  'heading-only': 'Only headings',
  'prompt-like': 'Looks like a request rather than a plan',
  'system-context': 'System context',
  'execution-report': 'Report of completed work',
  'progress-narrative': 'Progress narration',
  'review-output': 'Review findings',
  'wrapper-title': 'Agent wrapper title',
  'tool-log': 'Tool log',
  'conversation-artifact': 'Conversation transcript',
  'code-only': 'Only code',
  'code-dominated': 'Mostly code without plan structure',
  'commit-message': 'Commit message',
  'no-plan-signals': 'No clear planning structure',
};
type Detail = { plan: Plan; check: PlanCheck; assessment: HiddenPlanSummary['assessment'] };

/** Intentional local recovery: content is only requested after selecting a summary. */
export function HiddenPlansPanel({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<HiddenPlanSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getHiddenPlans();
      if (!mounted.current) return;
      setRows(response.plans);
      setTotal(response.total);
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : 'Unable to load hidden plans');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  async function inspect(id: string) {
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const response = await api.getHiddenPlan(id);
      if (mounted.current && request === generation.current) setDetail(response);
    } catch (error) {
      if (mounted.current && request === generation.current)
        setError(error instanceof Error ? error.message : 'Unable to inspect plan');
    } finally {
      if (mounted.current && request === generation.current) setBusy(false);
    }
  }
  async function override(restore: boolean) {
    if (!detail) return;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      await api.setHiddenPlanOverride(detail.plan.id, restore);
      if (!mounted.current || request !== generation.current) return;
      setDetail(null);
      await load();
      window.dispatchEvent(new Event('agendex:visibility-changed'));
      onChanged?.();
    } catch (error) {
      if (mounted.current && request === generation.current)
        setError(error instanceof Error ? error.message : 'Unable to update visibility');
    } finally {
      if (mounted.current && request === generation.current) setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.getHiddenPlans(rows.length);
      if (mounted.current) {
        setRows((current) => [
          ...current,
          ...response.plans.filter((row) => !current.some((item) => item.id === row.id)),
        ]);
        setTotal(response.total);
      }
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : 'Unable to load more plans');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="hidden-plans-panel" aria-label="Hidden plan recovery">
      <h4>Hidden plan recovery</h4>
      <p>
        The classifier hides likely prompts, logs and completed-work reports. Inspect its reasons
        and restore plans you want to keep. Source files are never changed.
      </p>
      <p>
        This view uses the connected local server. Cloud sync prunes low-value content; recover it
        on the source device, then sync again.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading local hidden plans…</p>
      ) : (
        <>
          <p>
            {total} hidden or manually restored {total === 1 ? 'plan' : 'plans'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDetail(null);
              void load();
            }}
          >
            Refresh recovery list
          </button>
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <button type="button" disabled={busy} onClick={() => void inspect(row.id)}>
                  {row.title || 'Untitled plan'} · {row.agent} ·{' '}
                  {row.restored ? 'Restored' : 'Hidden'}
                </button>
                <p>
                  {row.assessment.reasons.map((reason) => REASONS[reason] ?? reason).join('; ') ||
                    'Automatic classification currently considers this a plan'}
                </p>
              </li>
            ))}
          </ul>
          {rows.length < total && (
            <button type="button" disabled={busy} onClick={() => void more()}>
              Load more
            </button>
          )}
        </>
      )}
      {busy && <p role="status">Updating recovery view…</p>}
      {detail && (
        <article>
          <h4>{detail.plan.title || 'Untitled plan'}</h4>
          <p>
            <code>{detail.plan.filePath}</code>
          </p>
          <p>
            Automatic classifier: {detail.assessment.lowValue ? 'hidden' : 'visible'}.{' '}
            {detail.assessment.reasons.map((reason) => REASONS[reason] ?? reason).join('; ')}
          </p>
          <details>
            <summary>Classifier signals</summary>
            <ul>
              {detail.assessment.signals.map((signal) => (
                <li key={signal}>
                  <code>{signal}</code>
                </li>
              ))}
            </ul>
          </details>
          <PlanCheckSection plan={detail.plan} paths={null} checked={detail.check} />
          <pre className="hidden-plan-content">{detail.plan.content || '(Empty plan)'}</pre>
          <button
            type="button"
            disabled={busy}
            onClick={() => void override(detail.plan.metadata.localPlanValueOverride !== true)}
          >
            {detail.plan.metadata.localPlanValueOverride === true
              ? 'Undo restore: use automatic classification'
              : 'Restore to visible plans'}
          </button>
        </article>
      )}
    </section>
  );
}
