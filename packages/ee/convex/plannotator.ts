import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { plannotatorWritebackValidator } from './validators';

const WRITEBACK_TTL_MS = 24 * 60 * 60 * 1000;
const WRITEBACK_EXPIRED_ERROR = 'Write-back expired before a daemon could send it.';
const MAX_POLL_LIMIT = 25;
const MAX_EXPIRED_WRITEBACK_SWEEP = 200;
const MAX_LIVE_RESOLVE_SCAN = 2_000;

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
  // Require positive proof of liveness (`liveness === 'live'`), matching the
  // dashboard badge's reachability check. A `writebackCapable` row that lacks a
  // `liveness` field (synced before liveness tracking, or a session whose PID
  // died unobserved) is treated as not reachable so we never enable write-backs
  // the daemon cannot deliver.
  return (
    plannotator?.kind === 'live-session' &&
    plannotator.writebackCapable === true &&
    plannotator.liveness === 'live'
  );
}

// All continuity keys a session could be indexed under, in descending
// specificity. Must mirror `plannotatorContinuityKeys` in cli.ts so resolution
// and superseding agree. The first entry is the canonical key.
function plannotatorContinuityKeys(plan: { metadata?: unknown; filePath?: string }): string[] {
  const plannotator = getPlannotatorMetadata(plan);
  if (plannotator?.kind !== 'live-session') return [];

  const keys: string[] = [];

  const sourcePlanPath =
    typeof plannotator.sourcePlanPath === 'string' ? plannotator.sourcePlanPath.trim() : '';
  if (sourcePlanPath) keys.push(`source:${sourcePlanPath}`);

  const reviewId = typeof plannotator.reviewId === 'string' ? plannotator.reviewId.trim() : '';
  if (reviewId) keys.push(`review:${reviewId}`);

  const project = typeof plannotator.project === 'string' ? plannotator.project.trim() : '';
  const label = typeof plannotator.label === 'string' ? plannotator.label.trim() : '';
  const mode = typeof plannotator.mode === 'string' ? plannotator.mode.trim() : '';
  if (project && label) keys.push(`project:${project}:label:${label}:mode:${mode}`);

  const path = plan.filePath?.trim();
  if (path) keys.push(`path:${path}`);

  const sessionPath =
    typeof plannotator.sessionPath === 'string' ? plannotator.sessionPath.trim() : '';
  if (sessionPath) keys.push(`path:${sessionPath}`);

  return keys;
}

function getSupersededByPlanId(plan: { metadata?: unknown }): string | undefined {
  const plannotator = getPlannotatorMetadata(plan);
  const value = plannotator?.supersededByPlanId;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function findCurrentLivePlannotatorPlan(
  ctx: QueryCtx,
  ownerId: string,
  plan: Doc<'plans'>,
  // When true, fall back to a bounded owner scan if key/pointer resolution finds
  // nothing. This bridges a continuity-key scheme change (e.g. an ended `path:`
  // row whose live replacement is indexed only under `source:`) when no
  // `supersededByPlanId` link was written. The scan only runs as a last resort
  // (no index/pointer match), so common-case reads stay narrow.
  deepScan = false,
): Promise<Doc<'plans'>> {
  const liveCandidates: Doc<'plans'>[] = [];
  const seen = new Set<string>();
  // Candidate keys span the requested plan AND every row reached via supersession
  // pointers, so resolution covers continuity-key scheme changes (e.g. legacy
  // `path:` rows superseded by `source:` rows) that key lookups alone cannot
  // bridge. We never short-circuit on a pointer target: it is just another
  // candidate, so a stale-but-live pointer row cannot beat a newer replacement.
  const keySet = new Set<string>(plannotatorContinuityKeys(plan));
  const consider = (candidate: Doc<'plans'>): void => {
    if (seen.has(candidate._id)) return;
    seen.add(candidate._id);
    if (planHasLivePlannotatorMetadata(candidate)) liveCandidates.push(candidate);
  };

  // 1) Follow explicit supersession pointers, collecting each hop as a candidate
  //    and folding its continuity keys into the search set.
  let current: Doc<'plans'> | undefined = plan;
  const visited = new Set<string>([plan._id]);
  for (let hops = 0; hops < 16 && current; hops++) {
    consider(current);
    for (const key of plannotatorContinuityKeys(current)) keySet.add(key);
    const nextId = getSupersededByPlanId(current);
    if (!nextId || visited.has(nextId)) break;
    const next = await ctx.db.get(nextId as Id<'plans'>);
    if (!next || next.ownerId !== ownerId) break;
    visited.add(next._id);
    current = next;
  }

  // 2) Continuity-key resolution over the full candidate-key set. Derive keys
  //    from current metadata rather than trusting the persisted
  //    `plannotatorContinuityKey` column, which can be stale on older rows if the
  //    continuity-derivation rules changed since they were last synced. Match on
  //    set intersection so a replacement indexed under any shared key — across
  //    `source:`/`path:` scheme changes — is found. Symmetric with cli.ts.
  if (keySet.size === 0) return plan;
  for (const key of keySet) {
    const rows = await ctx.db
      .query('plans')
      .withIndex('by_owner_plannotatorContinuityKey', (q) =>
        q.eq('ownerId', ownerId).eq('plannotatorContinuityKey', key),
      )
      .collect();
    for (const row of rows) {
      if (seen.has(row._id)) continue;
      seen.add(row._id);
      if (!planHasLivePlannotatorMetadata(row)) continue;
      if (!plannotatorContinuityKeys(row).some((rowKey) => keySet.has(rowKey))) continue;
      liveCandidates.push(row);
    }
  }

  // Last resort: when nothing was found via pointers or the continuity-key index,
  // scan the owner's recent plans for a live row that shares any candidate key.
  // The index only stores each row's canonical key, so a replacement indexed
  // under `source:` is invisible to a lookup by an ended row's `path:` key — the
  // scan recovers that link.
  if (deepScan && liveCandidates.length === 0) {
    const ownerPlans = await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .order('desc')
      .take(MAX_LIVE_RESOLVE_SCAN);
    for (const row of ownerPlans) {
      if (seen.has(row._id)) continue;
      seen.add(row._id);
      if (!planHasLivePlannotatorMetadata(row)) continue;
      if (!plannotatorContinuityKeys(row).some((rowKey) => keySet.has(rowKey))) continue;
      liveCandidates.push(row);
    }
  }

  return (
    // Newest session wins, with a stable `_id` tiebreaker. Must stay in sync with
    // the dashboard's `findLivePlannotatorReplacement` so the UI follows the same
    // canonical plan that receives write-backs.
    liveCandidates.sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1))[0] ?? plan
  );
}

// Move still-pending write-backs from a superseded session's local id onto the
// canonical one. A live-session identity change (e.g. session-path hash ->
// sourcePlanPath hash) leaves older pending jobs pointing at a `localPlanId` the
// upgraded daemon no longer resolves via `getById`; repointing them lets the
// daemon deliver instead of failing them out.
async function remapPendingWritebacks(
  ctx: MutationCtx,
  ownerId: string,
  fromLocalPlanId: string | undefined,
  toLocalPlanId: string,
  toPlanId: Id<'plans'>,
  now: number,
): Promise<void> {
  if (!fromLocalPlanId || fromLocalPlanId === toLocalPlanId) return;
  const pending = await ctx.db
    .query('plannotatorWritebacks')
    .withIndex('by_owner_localPlanId', (q) =>
      q.eq('ownerId', ownerId).eq('localPlanId', fromLocalPlanId),
    )
    .filter((q) => q.eq(q.field('status'), 'pending'))
    .collect();
  for (const row of pending) {
    await ctx.db.patch(row._id, { localPlanId: toLocalPlanId, planId: toPlanId, updatedAt: now });
  }
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

  await remapPendingWritebacks(
    ctx,
    plan.ownerId,
    plan.localPlanId,
    targetPlan.localPlanId,
    targetPlan._id,
    now,
  );
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
  returns: v.id('plannotatorWritebacks'),
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
    const plan = await findCurrentLivePlannotatorPlan(ctx, user._id, requestedPlan, true);
    if (plan._id !== requestedPlan._id) {
      await markSupersededPlannotatorPlan(ctx, requestedPlan, plan, now);
    }

    const localPlanId = plan.localPlanId;
    if (!localPlanId) throw new ConvexError('Plan is not linked to a local daemon record');
    if (!planHasLivePlannotatorMetadata(plan)) {
      throw new ConvexError('Plan is not a live Plannotator session');
    }
    // Guard against duplicate approvals: `findCurrentLivePlannotatorPlan` may
    // resolve to a canonical plan different from the one the user viewed, and
    // that canonical plan may already be approved.
    if (action === 'approve' && getPlannotatorMetadata(plan)?.status === 'approved') {
      throw new ConvexError('Plan is already approved');
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
  returns: v.array(plannotatorWritebackValidator),
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

// Resolves the canonical live plan for a (possibly superseded) plan and reports
// its write-back gating state. The UI uses this so approve/request actions are
// gated on the plan `enqueueWriteback` will actually target, not on a stale or
// superseded row the user happens to be viewing.
export const getCanonicalWritebackState = query({
  args: { planId: v.id('plans') },
  returns: v.object({
    canonicalPlanId: v.id('plans'),
    isLive: v.boolean(),
    isApproved: v.boolean(),
    // Expiry (ms) of the latest-expiring active pending write-back, or null when
    // none. The client compares this against the current time so an *expired*
    // pending row — which `enqueueWriteback` treats as non-blocking — does not
    // lock the panel. Returning the timestamp (rather than a boolean) keeps the
    // query deterministic and cacheable instead of depending on `Date.now()`.
    pendingWritebackExpiresAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const requestedPlan = await ctx.db.get(args.planId);
    if (!requestedPlan) throw new ConvexError('Plan not found');
    if (requestedPlan.ownerId !== user._id) throw new ConvexError('Access denied');

    // Deep scan so the panel's gating matches what `enqueueWriteback` (which also
    // deep-scans) will resolve. The scan only runs as a last resort when index
    // and pointer resolution find nothing, so common-case reads stay narrow.
    const plan = await findCurrentLivePlannotatorPlan(ctx, user._id, requestedPlan, true);
    const plannotator = getPlannotatorMetadata(plan);
    const isLive = planHasLivePlannotatorMetadata(plan);
    const isApproved = plannotator?.status === 'approved';

    let pendingWritebackExpiresAt: number | null = null;
    const canonicalLocalPlanId = plan.localPlanId;
    if (canonicalLocalPlanId) {
      const pendingRows = await ctx.db
        .query('plannotatorWritebacks')
        .withIndex('by_owner_localPlanId', (q) =>
          q.eq('ownerId', user._id).eq('localPlanId', canonicalLocalPlanId),
        )
        .filter((q) => q.eq(q.field('status'), 'pending'))
        .collect();
      for (const row of pendingRows) {
        if (pendingWritebackExpiresAt === null || row.expiresAt > pendingWritebackExpiresAt) {
          pendingWritebackExpiresAt = row.expiresAt;
        }
      }
    }

    return {
      canonicalPlanId: plan._id,
      isLive,
      isApproved,
      pendingWritebackExpiresAt,
    };
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
