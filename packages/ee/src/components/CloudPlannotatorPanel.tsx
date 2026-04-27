import type { PlannotatorMetadata } from '@agendex/shared';
import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getPlannotatorMetadata(plan: Plan): PlannotatorMetadata | undefined {
  if (!isRecord(plan.metadata)) return undefined;
  const value = plan.metadata.plannotator;
  if (!isRecord(value)) return undefined;
  if (value.kind !== 'snapshot' && value.kind !== 'live-session' && value.kind !== 'project-plan') {
    return undefined;
  }
  return value as unknown as PlannotatorMetadata;
}

function isSafeLoopbackUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function statusColor(status: string | undefined): string {
  if (status === 'approved' || status === 'sent') return '#22c55e';
  if (status === 'denied' || status === 'failed') return '#ef4444';
  if (status === 'pending') return '#f59e0b';
  return '#64748b';
}

export function CloudPlannotatorBadge({ plan }: { plan: Plan }) {
  const metadata = getPlannotatorMetadata(plan);
  if (!metadata) return null;

  const label =
    metadata.kind === 'live-session'
      ? 'Plannotator live'
      : metadata.kind === 'project-plan'
        ? 'Plannotator project plan'
        : 'Plannotator snapshot';
  const status = metadata.status ?? (metadata.kind === 'live-session' ? 'pending' : 'unknown');

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold"
        style={{ borderColor: `${statusColor(status)}66`, color: statusColor(status) }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: statusColor(status) }}
        />
        {label}
      </span>
      <span className="text-[11px] text-tertiary">
        {metadata.origin ? `Origin: ${metadata.origin}` : 'Origin unknown'}
        {metadata.project ? ` · ${metadata.project}` : ''}
      </span>
      {isSafeLoopbackUrl(metadata.url) && (
        <a
          href={metadata.url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-secondary underline decoration-dotted underline-offset-4"
        >
          Open in Plannotator
        </a>
      )}
    </div>
  );
}

export function CloudPlannotatorWritebackPanel({ plan }: { plan: Plan }) {
  const metadata = getPlannotatorMetadata(plan);
  const isLive = metadata?.kind === 'live-session' && metadata.writebackCapable === true;
  const enqueueWriteback = useMutation(api.plannotator.enqueueWriteback);
  const writebacks = useQuery(
    api.plannotator.listWritebacksForPlan,
    metadata ? { planId: plan.id as Id<'plans'> } : 'skip',
  );
  const [feedback, setFeedback] = useState('');
  const [revisedContent, setRevisedContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [queued, setQueued] = useState(false);

  const latest = useMemo(() => writebacks?.[0], [writebacks]);

  if (!metadata) return null;

  async function requestChanges() {
    if (!feedback.trim() && !revisedContent.trim()) return;
    setSubmitting(true);
    setError(undefined);
    setQueued(false);
    try {
      await enqueueWriteback({
        planId: plan.id as Id<'plans'>,
        feedback: feedback.trim(),
        revisedContent: revisedContent.trim() || undefined,
      });
      setFeedback('');
      setRevisedContent('');
      setQueued(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue request');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-text">Plannotator write-back</h2>
          <p className="mt-1 text-[12px] text-tertiary">
            {isLive
              ? 'Queue structured request-changes feedback for your local Agendex daemon to send back through Plannotator.'
              : 'This is a saved Plannotator plan. Write-back is only available for live sessions.'}
          </p>
        </div>
        {latest && (
          <span
            className="rounded-full border px-2 py-1 text-[11px] font-semibold"
            style={{
              borderColor: `${statusColor(latest.status)}66`,
              color: statusColor(latest.status),
            }}
          >
            {latest.status}
          </span>
        )}
      </div>

      {isLive && (
        <div className="mt-4 space-y-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe the changes the agent should make before resubmitting the plan..."
            className="min-h-[92px] w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-5 text-text outline-none"
          />
          <textarea
            value={revisedContent}
            onChange={(e) => setRevisedContent(e.target.value)}
            placeholder="Optional: paste revised plan content or a specific replacement section..."
            className="min-h-[72px] w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-5 text-text outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-tertiary">
              {queued && 'Queued for daemon delivery.'}
              {error && <span className="text-[#ef4444]">{error}</span>}
              {!queued && !error && latest?.error ? latest.error : null}
            </div>
            <button
              type="button"
              onClick={requestChanges}
              disabled={submitting || (!feedback.trim() && !revisedContent.trim())}
              className="rounded-lg border-0 bg-text px-3 py-1.5 text-[12px] font-semibold text-bg disabled:opacity-50"
            >
              {submitting ? 'Queueing…' : 'Request changes'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
