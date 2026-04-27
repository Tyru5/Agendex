import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

const WRITEBACK_TTL_MS = 24 * 60 * 60 * 1000;
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

function planHasLivePlannotatorMetadata(plan: { metadata?: unknown }): boolean {
  if (!isRecord(plan.metadata)) return false;
  const plannotator = plan.metadata.plannotator;
  if (!isRecord(plannotator)) return false;
  return plannotator.kind === 'live-session' && plannotator.writebackCapable === true;
}

function getPlanSyncDeviceId(plan: { metadata?: unknown }): string | undefined {
  if (!isRecord(plan.metadata)) return undefined;
  const sync = plan.metadata.agendexSync;
  if (!isRecord(sync)) return undefined;
  return typeof sync.deviceId === 'string' && sync.deviceId.trim() ? sync.deviceId : undefined;
}

export const enqueueWriteback = mutation({
  args: {
    planId: v.id('plans'),
    feedback: v.string(),
    revisedContent: v.optional(v.string()),
    annotations: v.optional(v.array(feedbackAnnotation)),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.PLANNOTATOR_INTEGRATION);

    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError('Plan not found');
    if (plan.ownerId !== user._id) throw new ConvexError('Access denied');
    if (!plan.localPlanId) throw new ConvexError('Plan is not linked to a local daemon record');
    if (!planHasLivePlannotatorMetadata(plan)) {
      throw new ConvexError('Plan is not a live Plannotator session');
    }

    const feedback = args.feedback.trim();
    const revisedContent = args.revisedContent?.trim();
    if (!feedback && !revisedContent) {
      throw new ConvexError('Feedback or revised content is required');
    }

    const now = Date.now();
    return await ctx.db.insert('plannotatorWritebacks', {
      ownerId: user._id,
      planId: args.planId,
      localPlanId: plan.localPlanId,
      deviceId: args.deviceId ?? getPlanSyncDeviceId(plan),
      feedback,
      revisedContent,
      annotations: args.annotations,
      source: 'agendex-cloud',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + WRITEBACK_TTL_MS,
    });
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

    return await ctx.db
      .query('plannotatorWritebacks')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('desc')
      .take(20);
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

    const rows = await ctx.db
      .query('plannotatorWritebacks')
      .withIndex('by_owner_status', (q) => q.eq('ownerId', args.ownerId).eq('status', 'pending'))
      .take(limit * 4);

    return rows
      .filter((row) => {
        if (row.expiresAt <= now) return false;
        if (!args.deviceId) return true;
        return !row.deviceId || row.deviceId === args.deviceId;
      })
      .slice(0, limit);
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
        error: 'Write-back expired before a daemon could send it.',
        updatedAt: args.now,
      });
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

    const now = Date.now();
    await ctx.db.patch(args.writebackId, {
      status: args.status,
      error: args.error,
      updatedAt: now,
      sentAt: args.status === 'sent' ? now : row.sentAt,
    });
  },
});
