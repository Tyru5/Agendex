import {
  formatPlanAnnotationFeedback,
  toPlannotatorFeedbackAnnotations,
  type PlanAnnotationRecord as SharedPlanAnnotationRecord,
} from '@agendex/shared/annotations';
import { decryptWorkspaceValue, encryptWorkspaceValue } from '@agendex/shared/crypto';
import type { Plan, PlanAnnotationCreateDraft, PlanAnnotationRecord } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';
import { useWorkspaceCryptoStatus } from '../hooks/useCloudMetadataCrypto.ts';
import { withWorkspaceKey } from '../lib/obfuscation-keyring.ts';
import { buildEncryptedWriteback } from '../lib/plannotator-crypto.ts';
import { DANGER_BUTTON, GHOST_BUTTON, PRIMARY_BUTTON } from './CloudPlannotatorPanel.tsx';

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
  stableCryptoId?: string;
  keyEpoch?: number;
  encryptedAnnotation?: unknown;
};

type PrivateAnnotationValue = {
  authorName: string;
  source?: string;
  body?: string;
  replacementText?: string;
  anchor: PlanAnnotationRecord['anchor'];
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

type PlannotatorPanelVariant = 'stack' | 'rail';

function panelClassName(variant: PlannotatorPanelVariant): string {
  return `plannotator-panel plannotator-panel--${variant}`;
}

function typeLabel(type: PlanAnnotationRecord['type']): string {
  return type.replace('_', ' ');
}

export function useCloudPlanAnnotations({
  plan,
  enabled,
}: {
  plan: Plan | undefined;
  enabled: boolean;
}) {
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | undefined>();
  const { user } = useAuth();
  const cryptoStatus = useWorkspaceCryptoStatus(enabled);
  const createAnnotationMutation = useMutation(api.annotations.createAnnotation);
  const docs = useQuery(
    api.annotations.listForPlan,
    enabled && plan ? { planId: plan.id as Id<'plans'> } : 'skip',
  ) as AnnotationDoc[] | undefined;

  const annotations = useMemo(
    () =>
      (docs ?? []).map((doc) => {
        if (
          !doc.encryptedAnnotation ||
          !doc.stableCryptoId ||
          !doc.keyEpoch ||
          !cryptoStatus?.workspaceOwnerId
        ) {
          return toWebAnnotation(doc);
        }
        const { encryptedAnnotation, stableCryptoId, keyEpoch } = doc;
        const workspaceOwnerId = cryptoStatus.workspaceOwnerId;
        try {
          const privateValue = withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
            decryptWorkspaceValue<PrivateAnnotationValue>({
              workspaceKey,
              workspaceOwnerId,
              keyEpoch,
              table: 'planAnnotations',
              slot: 'annotation',
              stableCryptoId,
              envelope: encryptedAnnotation,
            }),
          );
          return toWebAnnotation({ ...doc, ...privateValue });
        } catch {
          return toWebAnnotation({
            ...doc,
            authorName: 'Locked annotation',
            body: 'Unlock Obfuscation to read this annotation.',
            anchor: {},
          });
        }
      }),
    [cryptoStatus, docs],
  );

  async function createAnnotation(draft: PlanAnnotationCreateDraft) {
    if (!plan) {
      setCreateError('Failed to create annotation');
      return false;
    }
    setCreateError(undefined);
    try {
      const base = {
        planId: plan.id as Id<'plans'>,
        type: draft.type,
        body: draft.body,
        replacementText: draft.replacementText,
        anchor: draft.anchor,
        status: 'open',
        source: 'agendex-cloud',
      } as const;
      const cryptoSettings = cryptoStatus?.settings;
      const encrypted = cryptoSettings
        ? withWorkspaceKey(cryptoStatus.workspaceOwnerId, (workspaceKey) => {
            const value = encryptWorkspaceValue({
              workspaceKey,
              workspaceOwnerId: cryptoStatus.workspaceOwnerId,
              keyEpoch: cryptoSettings.activeKeyEpoch,
              table: 'planAnnotations',
              slot: 'annotation',
              value: {
                authorName: user?.name ?? 'Anonymous',
                source: 'agendex-cloud',
                body: draft.body,
                replacementText: draft.replacementText,
                anchor: draft.anchor,
              } satisfies PrivateAnnotationValue,
            });
            return {
              planId: base.planId,
              type: base.type,
              status: base.status,
              source: base.source,
              anchor: {
                startOffset: draft.anchor.startOffset,
                endOffset: draft.anchor.endOffset,
                occurrenceIndex: draft.anchor.occurrenceIndex,
              },
              clientCryptoProtocol: 1,
              stableCryptoId: value.stableCryptoId,
              keyEpoch: value.keyEpoch,
              encryptedAnnotation: value.envelope,
            };
          })
        : base;
      const id = await createAnnotationMutation(encrypted);
      setSelectedAnnotationId(id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create annotation');
      return false;
    }
  }

  function clearCreateError() {
    setCreateError(undefined);
  }

  return {
    annotations,
    selectedAnnotationId,
    setSelectedAnnotationId,
    createAnnotation,
    createError,
    clearCreateError,
  };
}

export function CloudPlanAnnotationsPanel({
  plan,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  canWriteAnnotations = false,
  daemonAvailable = true,
  variant = 'stack',
}: {
  plan: Plan;
  annotations: PlanAnnotationRecord[];
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  canWriteAnnotations?: boolean;
  daemonAvailable?: boolean;
  variant?: PlannotatorPanelVariant;
}) {
  const enqueueWriteback = useMutation(api.plannotator.enqueueWriteback);
  const updateAnnotation = useMutation(api.annotations.updateAnnotation);
  const deleteAnnotation = useMutation(api.annotations.deleteAnnotation);
  const cryptoStatus = useWorkspaceCryptoStatus();
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
  const canWriteback =
    canWriteAnnotations &&
    isLivePlannotatorPlan(plan) &&
    daemonAvailable &&
    openAnnotations.length > 0;

  async function submitAnnotations() {
    if (!canWriteback) return;
    setSubmitting(true);
    setError(undefined);
    setQueued(false);
    try {
      const sharedAnnotations = openAnnotations.map(toSharedAnnotation);
      const feedback = formatPlanAnnotationFeedback(sharedAnnotations);
      const writebackAnnotations = toPlannotatorFeedbackAnnotations(sharedAnnotations);
      const encrypted = cryptoStatus?.settings
        ? buildEncryptedWriteback({
            workspaceOwnerId: cryptoStatus.workspaceOwnerId,
            keyEpoch: cryptoStatus.settings.activeKeyEpoch,
            plan,
            feedback,
            annotations: writebackAnnotations,
          })
        : { feedback, annotations: writebackAnnotations };
      await enqueueWriteback({
        planId: plan.id as Id<'plans'>,
        ...encrypted,
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
    setError(undefined);
    setQueued(false);
    try {
      await updateAnnotation({
        annotationId: annotation.id as Id<'planAnnotations'>,
        status: annotation.status === 'resolved' ? 'open' : 'resolved',
        ...(cryptoStatus?.settings ? { clientCryptoProtocol: 1 } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update annotation');
    }
  }

  async function removeAnnotation(annotation: PlanAnnotationRecord) {
    setError(undefined);
    setQueued(false);
    try {
      await deleteAnnotation({ annotationId: annotation.id as Id<'planAnnotations'> });
      if (selectedAnnotationId === annotation.id) onSelectAnnotation?.(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete annotation');
    }
  }

  const showSubmitAction = canWriteAnnotations && openAnnotations.length > 0;

  return (
    <section className={panelClassName(variant)} aria-label="Plan annotations">
      <div className="plannotator-panel-header">
        <div className="min-w-0">
          <h2 className="plannotator-panel-title">Plan annotations</h2>
          <div className="plannotator-panel-metrics" aria-label="Annotation counts">
            <span>
              <strong>{openAnnotations.length}</strong> open
            </span>
            <span>
              <strong>{unresolvedAnnotations.length}</strong> unresolved
            </span>
          </div>
        </div>
        {showSubmitAction && (
          <button
            type="button"
            onClick={submitAnnotations}
            disabled={submitting || !canWriteback}
            className={PRIMARY_BUTTON}
          >
            {submitting ? 'Submitting…' : daemonAvailable ? 'Submit to agent' : 'Daemon required'}
          </button>
        )}
      </div>

      {annotations.length === 0 ? (
        <div className="plannotator-empty-state">
          {canWriteAnnotations
            ? 'Highlight text in the plan to add comments, replacements, or deletion notes.'
            : 'No plan annotations.'}
        </div>
      ) : (
        <div className="plannotator-annotation-list">
          {annotations.map((annotation) => {
            const selected = annotation.id === selectedAnnotationId;
            const canUpdateAnnotation = canWriteAnnotations && annotation.status !== 'submitted';
            return (
              <article
                key={annotation.id}
                className="plannotator-annotation-card"
                data-selected={selected ? 'true' : undefined}
              >
                <button
                  type="button"
                  onClick={() => onSelectAnnotation?.(selected ? null : annotation.id)}
                  className="plannotator-annotation-trigger"
                >
                  <div className="plannotator-annotation-card-top">
                    <span className="plannotator-annotation-type">
                      {typeLabel(annotation.type)}
                    </span>
                    <span className="plannotator-status-chip">
                      {statusLabel(annotation.status)}
                    </span>
                  </div>
                  <p className="plannotator-annotation-quote">{selectedQuote(annotation)}</p>
                </button>
                {annotation.body && (
                  <p className="plannotator-annotation-body">{annotation.body}</p>
                )}
                {annotation.replacementText && (
                  <div className="plannotator-annotation-replacement">
                    <span>Suggested replacement</span>
                    <p>{annotation.replacementText}</p>
                  </div>
                )}
                {canUpdateAnnotation && (
                  <div className="plannotator-annotation-actions">
                    <button
                      type="button"
                      onClick={() => void resolveAnnotation(annotation)}
                      className={GHOST_BUTTON}
                    >
                      {annotation.status === 'resolved' ? 'Reopen' : 'Resolve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeAnnotation(annotation)}
                      className={DANGER_BUTTON}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="plannotator-panel-note">
        {queued ? 'Queued selected annotations for daemon delivery.' : null}
        {error ? <span className="text-[var(--danger)]">{error}</span> : null}
        {!queued && !error && !canWriteAnnotations
          ? 'Only the plan owner can submit or update annotations.'
          : null}
        {!queued && !error && canWriteAnnotations && !isLivePlannotatorPlan(plan)
          ? 'Agent submission is available for live Plannotator sessions.'
          : null}
      </div>
    </section>
  );
}
