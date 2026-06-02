import {
  formatPlanAnnotationFeedback,
  toPlannotatorFeedbackAnnotations,
  type PlanAnnotationRecord as SharedPlanAnnotationRecord,
} from '@agendex/shared/annotations';
import type { Plan, PlanAnnotationCreateDraft, PlanAnnotationRecord } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';

type AnnotationDoc = {
  _id: Id<'planAnnotations'>;
  planId: Id<'plans'>;
  authorId: string;
  authorName: string;
  source?: string;
  type: PlanAnnotationRecord['type'];
  status: PlanAnnotationRecord['status'];
  body?: string;
  replacementText?: string;
  anchor: PlanAnnotationRecord['anchor'];
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  resolvedAt?: number;
  writebackId?: Id<'plannotatorWritebacks'>;
};

function toWebAnnotation(doc: AnnotationDoc): PlanAnnotationRecord {
  return {
    id: doc._id,
    planId: doc.planId,
    authorId: doc.authorId,
    authorName: doc.authorName,
    source: doc.source,
    type: doc.type,
    status: doc.status,
    body: doc.body,
    replacementText: doc.replacementText,
    anchor: doc.anchor,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    submittedAt: doc.submittedAt,
    resolvedAt: doc.resolvedAt,
    writebackId: doc.writebackId,
  };
}

function toSharedAnnotation(annotation: PlanAnnotationRecord): SharedPlanAnnotationRecord {
  return annotation as SharedPlanAnnotationRecord;
}

function statusLabel(status: PlanAnnotationRecord['status']): string {
  if (status === 'submitted') return 'queued';
  return status.replace('_', ' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLivePlannotatorPlan(plan: Plan): boolean {
  if (!isRecord(plan.metadata)) return false;
  const plannotator = plan.metadata.plannotator;
  return (
    isRecord(plannotator) &&
    plannotator.kind === 'live-session' &&
    plannotator.writebackCapable === true
  );
}

function selectedQuote(annotation: PlanAnnotationRecord): string {
  return annotation.anchor.quote || 'Whole-plan note';
}

export function useCloudPlanAnnotations({
  plan,
  enabled,
}: {
  plan: Plan | undefined;
  enabled: boolean;
}) {
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const createAnnotationMutation = useMutation(api.annotations.createAnnotation);
  const docs = useQuery(
    api.annotations.listForPlan,
    enabled && plan ? { planId: plan.id as Id<'plans'> } : 'skip',
  ) as AnnotationDoc[] | undefined;

  const annotations = useMemo(() => (docs ?? []).map(toWebAnnotation), [docs]);

  async function createAnnotation(draft: PlanAnnotationCreateDraft) {
    if (!plan) return;
    const id = await createAnnotationMutation({
      planId: plan.id as Id<'plans'>,
      type: draft.type,
      body: draft.body,
      replacementText: draft.replacementText,
      anchor: draft.anchor,
      status: 'open',
      source: 'agendex-cloud',
    });
    setSelectedAnnotationId(id);
  }

  return {
    annotations,
    selectedAnnotationId,
    setSelectedAnnotationId,
    createAnnotation,
  };
}

export function CloudPlanAnnotationsPanel({
  plan,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  daemonAvailable = true,
}: {
  plan: Plan;
  annotations: PlanAnnotationRecord[];
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  daemonAvailable?: boolean;
}) {
  const enqueueWriteback = useMutation(api.plannotator.enqueueWriteback);
  const updateAnnotation = useMutation(api.annotations.updateAnnotation);
  const deleteAnnotation = useMutation(api.annotations.deleteAnnotation);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [queued, setQueued] = useState(false);

  const unresolvedAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.status !== 'resolved'),
    [annotations],
  );
  const openAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.status === 'open'),
    [annotations],
  );
  const canWriteback = isLivePlannotatorPlan(plan) && daemonAvailable && openAnnotations.length > 0;

  async function submitAnnotations() {
    if (!canWriteback) return;
    setSubmitting(true);
    setError(undefined);
    setQueued(false);
    try {
      const sharedAnnotations = openAnnotations.map(toSharedAnnotation);
      const feedback = formatPlanAnnotationFeedback(sharedAnnotations);
      await enqueueWriteback({
        planId: plan.id as Id<'plans'>,
        feedback,
        annotations: toPlannotatorFeedbackAnnotations(sharedAnnotations),
        annotationIds: openAnnotations.map((annotation) => annotation.id as Id<'planAnnotations'>),
      });
      setQueued(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit annotations');
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveAnnotation(annotation: PlanAnnotationRecord) {
    await updateAnnotation({
      annotationId: annotation.id as Id<'planAnnotations'>,
      status: annotation.status === 'resolved' ? 'open' : 'resolved',
    });
  }

  async function removeAnnotation(annotation: PlanAnnotationRecord) {
    await deleteAnnotation({ annotationId: annotation.id as Id<'planAnnotations'> });
    if (selectedAnnotationId === annotation.id) onSelectAnnotation?.(null);
  }

  if (annotations.length === 0) {
    return (
      <section className="mt-8 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-[13px] font-semibold text-text">Plan annotations</h2>
        <p className="mt-1 text-[12px] text-tertiary">
          Highlight plan text to add structured feedback for the agent.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-text">Plan annotations</h2>
          <p className="mt-1 text-[12px] text-tertiary">
            {unresolvedAnnotations.length} unresolved · {openAnnotations.length} ready to submit
          </p>
        </div>
        <button
          type="button"
          onClick={submitAnnotations}
          disabled={submitting || !canWriteback}
          className="rounded-lg border-0 bg-text px-3 py-1.5 text-[12px] font-semibold text-bg disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : daemonAvailable ? 'Submit to agent' : 'Daemon required'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {annotations.map((annotation) => {
          const selected = annotation.id === selectedAnnotationId;
          return (
            <article
              key={annotation.id}
              className="rounded-lg border p-3"
              style={{
                borderColor: selected ? 'var(--warning)' : 'var(--border)',
                background: selected
                  ? 'color-mix(in oklch, var(--warning) 8%, transparent)'
                  : 'var(--bg)',
              }}
            >
              <button
                type="button"
                onClick={() => onSelectAnnotation?.(selected ? null : annotation.id)}
                className="w-full border-0 bg-transparent p-0 text-left font-[inherit]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-text">
                    {annotation.type.replace('_', ' ')}
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] text-tertiary">
                    {statusLabel(annotation.status)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11.5px] text-tertiary">
                  {selectedQuote(annotation)}
                </p>
              </button>
              {annotation.body && (
                <p className="mt-2 text-[12px] leading-5 text-secondary">{annotation.body}</p>
              )}
              {annotation.replacementText && (
                <p className="mt-2 rounded-md border border-border bg-surface px-2 py-1 text-[12px] leading-5 text-secondary">
                  {annotation.replacementText}
                </p>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void resolveAnnotation(annotation)}
                  className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px] font-medium text-secondary"
                >
                  {annotation.status === 'resolved' ? 'Reopen' : 'Resolve'}
                </button>
                <button
                  type="button"
                  onClick={() => void removeAnnotation(annotation)}
                  className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px] font-medium text-[var(--danger)]"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-3 min-h-[16px] text-[11px] text-tertiary">
        {queued && 'Queued selected annotations for daemon delivery.'}
        {error && <span className="text-[var(--danger)]">{error}</span>}
        {!isLivePlannotatorPlan(plan) &&
          'Agent submission is available for live Plannotator sessions.'}
      </div>
    </section>
  );
}
