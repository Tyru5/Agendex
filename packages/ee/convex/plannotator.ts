import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  query,
} from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

const WRITEBACK_TTL_MS = 24 * 60 * 60 * 1000;
const WRITEBACK_EXPIRED_ERROR = 'Write-back expired before a daemon could send it.';
const MAX_POLL_LIMIT = 25;
const MAX_EXPIRED_WRITEBACK_SWEEP = 200;

const planAnnotation = v.object({
  id: v.optional(v.string()),
  source: v.optional(v.string()),
  author: v.optional(v.string()),
  type: v.union(
    v.literal('DELETION'),
    v.literal('REPLACEMENT'),
    v.literal('INSERTION'),
    v.literal('COMMENT'),
    v.literal('GLOBAL_COMMENT'),
  ),
  text: v.optional(v.string()),
  originalText: v.optional(v.string()),
  replacementText: v.optional(v.string()),
  insertionText: v.optional(v.string()),
  blockId: v.optional(v.string()),
  startOffset: v.optional(v.number()),
  endOffset: v.optional(v.number()),
  createdAt: v.optional(v.number()),
});

const reviewAnnotation = v.object({
  id: v.optional(v.string()),
  source: v.optional(v.string()),
  author: v.optional(v.string()),
  type: v.union(v.literal('comment'), v.literal('suggestion'), v.literal('concern')),
  scope: v.optional(v.union(v.literal('line'), v.literal('file'))),
  filePath: v.string(),
  lineStart: v.number(),
  lineEnd: v.number(),
  side: v.optional(v.union(v.literal('old'), v.literal('new'))),
  text: v.optional(v.string()),
  suggestedCode: v.optional(v.string()),
  originalCode: v.optional(v.string()),
  severity: v.optional(v.string()),
  reasoning: v.optional(v.string()),
  createdAt: v.optional(v.number()),
});

const feedbackAnnotation = v.union(planAnnotation, reviewAnnotation);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPlannotatorMetadata(plan: { metadata?: unknown }): Record<string, unknown> | undefined {
  if (!isRecord(plan.metadata)) return undefined;
  const plannotator = plan.metadata.plannotator;
  return isRecord(plannotator) ? plannotator : undefined;
}

function planHasLivePlannotatorMetadata(plan: { metadata?: unknown }): boolean {
  const plannotator = getPlannotatorMetadata(plan);
  return (
    plannotator?.kind === 'live-session' &&
    plannotator.writebackCapable === true &&
    plannotator.liveness !== 'ended'
  );
}

function plannotatorContinuityKey(plan: {
  metadata?: unknown;
  filePath?: string;
}): string | undefined {
  const plannotator = getPlannotatorMetadata(plan);
  if (plannotator?.kind !== 'live-session') return undefined;

  const sourcePlanPath =
    typeof plannotator.sourcePlanPath === 'string' && plannotator.sourcePlanPath.trim()
      ? plannotator.sourcePlanPath.trim()
      : undefined;
  if (sourcePlanPath) return `source:${sourcePlanPath}`;

  if (typeof plannotator.reviewId === 'string' && plannotator.reviewId.trim()) {
    return `review:${plannotator.reviewId.trim()}`;
  }

  const project = typeof plannotator.project === 'string' ? plannotator.project.trim() : '';
  const label = typeof plannotator.label === 'string' ? plannotator.label.trim() : '';
  const mode = typeof plannotator.mode === 'string' ? plannotator.mode.trim() : '';
  if (project && label) return `project:${project}:label:${label}:mode:${mode}`;

  return plan.filePath ? `path:${plan.filePath}` : undefined;
}

function storedOrDerivedPlannotatorContinuityKey(plan: {
  metadata?: unknown;
  filePath?: string;
  plannotatorContinuityKey?: string;
}): string | undefined {
  return typeof plan.plannotatorContinuityKey === 'string' && plan.plannotatorContinuityKey.trim()
    ? plan.plannotatorContinuityKey
    : plannotatorContinuityKey(plan);
}

async function findCurrentLivePlannotatorPlan(
  ctx: MutationCtx,
  ownerId: string,
  plan: Doc<'plans'>,
): Promise<Doc<'plans'>> {
  const key = storedOrDerivedPlannotatorContinuityKey(plan);
  if (!key) return plan;

  const candidates = await ctx.db
    .query('plans')
    .withIndex('by_owner_plannotatorContinuityKey', (q) =>
      q.eq('ownerId', ownerId).eq('plannotatorContinuityKey', key),
    )
    .collect();

  return (
    candidates
      .filter(
        (candidate) =>
          planHasLivePlannotatorMetadata(candidate) &&
          storedOrDerivedPlannotatorContinuityKey(candidate) === key,
      )
      .sort((a, b) => b._creationTime - a._creationTime)[0] ?? plan
  );
}

async function markSupersededPlannotatorPlan(
  ctx: MutationCtx,
  plan: Doc<'plans'>,
  targetPlan: Doc<'plans'>,
  now: number,
): Promise<void> {
  if (plan._id === targetPlan._id || !targetPlan.localPlanId) return;

  const metadata = isRecord(plan.metadata) ? plan.metadata : {};
  const plannotator = getPlannotatorMetadata(plan);
  if (!plannotator) return;

  await ctx.db.patch(plan._id, {
    metadata: {
      ...metadata,
      plannotator: {
        ...plannotator,
        writebackCapable: false,
        liveness: 'ended',
        endedAt: now,
        supersededByLocalPlanId: targetPlan.localPlanId,
        supersededByPlanId: targetPlan._id,
      },
    },
  });
}

function getPlanSyncDeviceId(plan: { metadata?: unknown }): string | undefined {
  if (!isRecord(plan.metadata)) return undefined;
  const sync = plan.metadata.agendexSync;
  if (!isRecord(sync)) return undefined;
  return typeof sync.deviceId === 'string' && sync.deviceId.trim() ? sync.deviceId : undefined;
}

async function reopenWritebackAnnotations(
  ctx: MutationCtx,
  annotationIds: Id<'planAnnotations'>[] | undefined,
  writebackId: Id<'plannotatorWritebacks'>,
  now: number,
): Promise<void> {
  for (const annotationId of annotationIds ?? []) {
    const annotation = await ctx.db.get(annotationId);
    if (
      !annotation ||
      annotation.status !== 'submitted' ||
      annotation.writebackId !== writebackId
    ) {
      continue;
    }

    const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...nextAnnotation } = annotation;
    nextAnnotation.status = 'open';
    nextAnnotation.updatedAt = now;
    delete nextAnnotation.submittedAt;
    delete nextAnnotation.writebackId;
    await ctx.db.replace(annotationId, nextAnnotation);
  }
}

export const enqueueWriteback = mutation({
  args: {
    planId: v.id('plans'),
    action: v.optional(v.union(v.literal('request_changes'), v.literal('approve'))),
    feedback: v.string(),
    revisedContent: v.optional(v.string()),
    annotations: v.optional(v.array(feedbackAnnotation)),
    annotationIds: v.optional(v.array(v.id('planAnnotations'))),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.PLANNOTATOR_INTEGRATION);

    const requestedPlan = await ctx.db.get(args.planId);
    if (!requestedPlan) throw new ConvexError('Plan not found');
    if (requestedPlan.ownerId !== user._id) throw new ConvexError('Access denied');

    const action = args.action ?? 'request_changes';
    const feedback = args.feedback.trim();
    const revisedContent = args.revisedContent?.trim();
    if (action === 'request_changes' && !feedback && !revisedContent) {
      throw new ConvexError('Feedback or revised content is required');
    }

    const now = Date.now();
    const plan = await findCurrentLivePlannotatorPlan(ctx, user._id, requestedPlan);
    if (plan._id !== requestedPlan._id) {
      await markSupersededPlannotatorPlan(ctx, requestedPlan, plan, now);
    }

    const localPlanId = plan.localPlanId;
    if (!localPlanId) throw new ConvexError('Plan is not linked to a local daemon record');
    if (!planHasLivePlannotatorMetadata(plan)) {
      throw new ConvexError('Plan is not a live Plannotator session');
    }
    const pendingWritebacks = await ctx.db
      .query('plannotatorWritebacks')
      .withIndex('by_owner_localPlanId', (q) =>
        q.eq('ownerId', user._id).eq('localPlanId', localPlanId),
      )
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect();
    let hasActivePendingWriteback = false;
    for (const pendingWriteback of pendingWritebacks) {
      if (pendingWriteback.expiresAt > now) {
        hasActivePendingWriteback = true;
        continue;
      }
      await ctx.db.patch(pendingWriteback._id, {
        status: 'expired',
        error: WRITEBACK_EXPIRED_ERROR,
        updatedAt: now,
      });
      await reopenWritebackAnnotations(
        ctx,
        pendingWriteback.annotationIds,
        pendingWriteback._id,
        now,
      );
    }
    if (hasActivePendingWriteback) {
      throw new ConvexError('A write-back is already pending for this plan');
    }

    const annotationIds = args.annotationIds ?? [];
    for (const annotationId of annotationIds) {
      const annotation = await ctx.db.get(annotationId);
      if (
        !annotation ||
        (annotation.planId !== requestedPlan._id && annotation.planId !== plan._id)
      ) {
        throw new ConvexError('Annotation does not belong to this plan');
      }
      if (annotation.authorId !== user._id) {
        throw new ConvexError('Access denied');
      }
      if (annotation.status !== 'open') {
        throw new ConvexError('Only open annotations can be submitted');
      }
    }

    const writebackId = await ctx.db.insert('plannotatorWritebacks', {
      ownerId: user._id,
      planId: plan._id,
      localPlanId,
      deviceId: args.deviceId ?? getPlanSyncDeviceId(plan),
      action,
      feedback,
      revisedContent,
      annotations: args.annotations,
      annotationIds,
      source: 'agendex-cloud',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + WRITEBACK_TTL_MS,
    });

    for (const annotationId of annotationIds) {
      await ctx.db.patch(annotationId, {
        status: 'submitted',
        submittedAt: now,
        updatedAt: now,
        writebackId,
      });
    }

    return writebackId;
  },
});

export const listWritebacksForPlan = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError('Plan not found');
    if (plan.ownerId !== user._id) throw new ConvexError('Access denied');

    return (
      await ctx.db
        .query('plannotatorWritebacks')
        .withIndex('by_plan', (q) => q.eq('planId', args.planId))
        .order('desc')
        .take(20)
    ).filter((writeback) => writeback.ownerId === user._id);
  },
});

export const pollPendingWritebacks = internalQuery({
  args: {
    ownerId: v.string(),
    deviceId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), MAX_POLL_LIMIT);

    const queryLimit = limit * 4;

    if (args.deviceId) {
      const targetedRows = await ctx.db
        .query('plannotatorWritebacks')
        .withIndex('by_owner_device_status', (q) =>
          q.eq('ownerId', args.ownerId).eq('deviceId', args.deviceId).eq('status', 'pending'),
        )
        .take(queryLimit);
      const untargetedRows = await ctx.db
        .query('plannotatorWritebacks')
        .withIndex('by_owner_device_status', (q) =>
          q.eq('ownerId', args.ownerId).eq('deviceId', undefined).eq('status', 'pending'),
        )
        .take(queryLimit);

      return [...targetedRows, ...untargetedRows]
        .filter((row) => row.expiresAt > now)
        .slice(0, limit);
    }

    const rows = await ctx.db
      .query('plannotatorWritebacks')
      .withIndex('by_owner_status', (q) => q.eq('ownerId', args.ownerId).eq('status', 'pending'))
      .take(queryLimit);

    return rows.filter((row) => row.expiresAt > now).slice(0, limit);
  },
});

export const markExpiredWritebacks = internalMutation({
  args: { ownerId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query('plannotatorWritebacks')
      .withIndex('by_owner_status', (q) => q.eq('ownerId', args.ownerId).eq('status', 'pending'))
      .take(MAX_EXPIRED_WRITEBACK_SWEEP);

    let expired = 0;
    for (const row of pending) {
      if (row.expiresAt > args.now) continue;
      await ctx.db.patch(row._id, {
        status: 'expired',
        error: WRITEBACK_EXPIRED_ERROR,
        updatedAt: args.now,
      });
      await reopenWritebackAnnotations(ctx, row.annotationIds, row._id, args.now);
      expired++;
    }
    return { expired };
  },
});

export const reportWritebackStatus = internalMutation({
  args: {
    ownerId: v.string(),
    writebackId: v.id('plannotatorWritebacks'),
    status: v.union(v.literal('sent'), v.literal('failed'), v.literal('expired')),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.writebackId);
    if (!row || row.ownerId !== args.ownerId) {
      throw new ConvexError('Write-back not found');
    }
    if (row.status !== 'pending') {
      return;
    }

    const now = Date.now();
    await ctx.db.patch(args.writebackId, {
      status: args.status,
      error: args.error,
      updatedAt: now,
      sentAt: args.status === 'sent' ? now : row.sentAt,
    });

    if (args.status === 'sent') {
      const plan = await ctx.db.get(row.planId);
      const metadata = isRecord(plan?.metadata) ? plan.metadata : undefined;
      const plannotator = isRecord(metadata?.plannotator) ? metadata.plannotator : undefined;
      if (plan && plannotator) {
        await ctx.db.patch(row.planId, {
          metadata: {
            ...metadata,
            plannotator: {
              ...plannotator,
              ...(row.action === 'approve' ? { status: 'approved' } : {}),
              lastWritebackStatus: 'sent',
              lastWritebackAt: now,
            },
          },
          updatedAt: now,
        });
      }
    }

    if (args.status !== 'sent') {
      await reopenWritebackAnnotations(ctx, row.annotationIds, args.writebackId, now);
    }
  },
});
