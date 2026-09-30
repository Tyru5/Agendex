import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { authComponent } from './auth';
import { hasActiveSubscriptionForUserId } from './subscriptions';
import { isVisiblePlan } from './planVisibility';

export const reviewStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('changes_requested'),
  v.literal('cancelled'),
  v.literal('superseded'),
);
const reviewValidator = v.object({
  id: v.id('planReviewRequests'),
  planId: v.id('plans'),
  title: v.string(),
  reviewerName: v.string(),
  planVersion: v.number(),
  status: reviewStatusValidator,
  message: v.string(),
  decisionNote: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  unread: v.boolean(),
  canDecide: v.boolean(),
  canCancel: v.boolean(),
});
const pageValidator = paginationResultValidator(reviewValidator);

/** An exact revision, including title and format. Whitespace changes invalidate approval. */
export async function reviewRevision(plan: Pick<Doc<'plans'>, 'title' | 'content' | 'format'>) {
  const bytes = new TextEncoder().encode(JSON.stringify([plan.title, plan.content, plan.format]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function member(ctx: QueryCtx, ownerId: string, userId: string) {
  return ctx.db
    .query('workspaceMembers')
    .withIndex('by_workspace_member', (q) =>
      q.eq('workspaceOwnerId', ownerId).eq('memberId', userId),
    )
    .first();
}
async function requireUser(ctx: QueryCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new ConvexError('Unauthenticated');
  return user._id;
}
export async function requireReviewWorkspace(ctx: QueryCtx, ownerId: string, userId: string) {
  if (userId !== ownerId && !(await member(ctx, ownerId, userId)))
    throw new ConvexError('Access denied');
  if (!(await hasActiveSubscriptionForUserId(ctx, ownerId)))
    throw new ConvexError('Workspace subscription required');
}
const emptyReviewPage = () => ({ page: [], isDone: true, continueCursor: '' });

// Reactive reads return an empty page when access disappears, so revocation does
// not crash the already-open viewer. Mutations always reject denied access.
async function readablePlan(ctx: QueryCtx, planId: Id<'plans'>, userId: string) {
  const plan = await ctx.db.get(planId);
  if (!plan || !isVisiblePlan(plan)) return null;
  if (userId !== plan.ownerId && !(await member(ctx, plan.ownerId, userId))) return null;
  if (!(await hasActiveSubscriptionForUserId(ctx, plan.ownerId))) return null;
  return plan;
}
async function requirePlan(ctx: QueryCtx, planId: Id<'plans'>, userId: string) {
  const plan = await ctx.db.get(planId);
  if (!plan || !isVisiblePlan(plan)) throw new ConvexError('Plan not found');
  await requireReviewWorkspace(ctx, plan.ownerId, userId);
  return plan;
}
export async function effectiveReviewStatus(
  ctx: QueryCtx,
  row: Doc<'planReviewRequests'>,
  plan: Doc<'plans'> | null,
) {
  if (row.status === 'cancelled') return 'cancelled' as const;
  if (
    !plan ||
    !isVisiblePlan(plan) ||
    plan.ownerId !== row.workspaceOwnerId ||
    plan.version !== row.planVersion ||
    (await reviewRevision(plan)) !== row.revision
  )
    return 'superseded' as const;
  const membership = await ctx.db.get(row.reviewerMembershipId);
  if (
    !membership ||
    membership.workspaceOwnerId !== row.workspaceOwnerId ||
    membership.memberId !== row.reviewerId
  )
    return 'cancelled' as const;
  return row.status;
}
/**
 * Whether the assigned reviewer may still read this request, using the same
 * checks as review reads. Exports redact requester-authored content otherwise.
 */
export async function reviewerCanRead(ctx: QueryCtx, row: Doc<'planReviewRequests'>) {
  const plan = await ctx.db.get(row.planId);
  if (!plan || !isVisiblePlan(plan) || plan.ownerId !== row.workspaceOwnerId) return false;
  if (!(await member(ctx, row.workspaceOwnerId, row.reviewerId))) return false;
  return hasActiveSubscriptionForUserId(ctx, row.workspaceOwnerId);
}
async function dto(
  ctx: QueryCtx,
  row: Doc<'planReviewRequests'>,
  userId: string,
  workspaceReader = false,
) {
  // Re-check both participants on every read: a removed member must not retain plan access.
  const participant = userId === row.requesterId || userId === row.reviewerId;
  if (!participant && !workspaceReader) return null;
  const plan = await ctx.db.get(row.planId);
  if (!plan || !isVisiblePlan(plan) || plan.ownerId !== row.workspaceOwnerId) return null;
  if (userId !== row.workspaceOwnerId && !(await member(ctx, row.workspaceOwnerId, userId)))
    return null;
  if (!(await hasActiveSubscriptionForUserId(ctx, row.workspaceOwnerId))) return null;
  const status = await effectiveReviewStatus(ctx, row, plan);
  const isRequester = userId === row.requesterId;
  const readAt = isRequester ? row.requesterReadAt : row.reviewerReadAt;
  const seenStatus = isRequester ? row.requesterSeenStatus : row.reviewerSeenStatus;
  return {
    id: row._id,
    planId: row.planId,
    title: plan.title,
    reviewerName: row.reviewerName,
    planVersion: row.planVersion,
    status,
    message: row.message,
    decisionNote: row.decisionNote ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Receipts track review events only (server-time updatedAt plus the derived
    // status seen), never client-supplied plan timestamps.
    unread:
      participant &&
      ((readAt ?? 0) < row.updatedAt || (status !== row.status && seenStatus !== status)),
    canDecide: userId === row.reviewerId && status === 'pending',
    canCancel: userId === row.requesterId && status === 'pending',
  };
}

export const eligibleReviewers = query({
  args: { planId: v.id('plans') },
  returns: v.array(v.object({ id: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];
    const userId = user._id;
    const plan = await readablePlan(ctx, args.planId, userId);
    if (!plan || plan.ownerId !== userId) return [];
    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', userId))
      .take(100);
    return members
      .filter((m) => m.memberId !== userId)
      .map((m) => ({ id: m.memberId, name: m.email }));
  },
});

export const request = mutation({
  args: { planId: v.id('plans'), reviewerIds: v.array(v.string()), message: v.string() },
  returns: v.array(v.id('planReviewRequests')),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const plan = await requirePlan(ctx, args.planId, userId);
    if (plan.ownerId !== userId) throw new ConvexError('Only the plan owner can request review');
    if (
      !args.reviewerIds.length ||
      args.reviewerIds.length > 10 ||
      new Set(args.reviewerIds).size !== args.reviewerIds.length
    )
      throw new ConvexError('Select 1–10 distinct reviewers');
    if (args.message.length > 4000) throw new ConvexError('Request message is too long');
    const revision = await reviewRevision(plan);
    const ids: Id<'planReviewRequests'>[] = [];
    for (const reviewerId of args.reviewerIds) {
      if (reviewerId === userId) throw new ConvexError('You cannot review your own plan');
      const membership = await member(ctx, userId, reviewerId);
      if (!membership) throw new ConvexError('Reviewer must be a current workspace member');
      const existing = await ctx.db
        .query('planReviewRequests')
        .withIndex('by_plan_and_reviewer_and_version', (q) =>
          q.eq('planId', plan._id).eq('reviewerId', reviewerId).eq('planVersion', plan.version),
        )
        .order('desc')
        .first();
      if (
        existing &&
        existing.revision === revision &&
        existing.reviewerMembershipId === membership._id &&
        existing.status !== 'cancelled'
      ) {
        ids.push(existing._id); // Retry-safe: decisions cannot be silently reset by duplicate requests.
        continue;
      }
      const now = Date.now();
      ids.push(
        await ctx.db.insert('planReviewRequests', {
          planId: plan._id,
          workspaceOwnerId: userId,
          requesterId: userId,
          reviewerId,
          reviewerName: membership.email,
          reviewerMembershipId: membership._id,
          planVersion: plan.version,
          revision,
          status: 'pending',
          message: args.message.trim(),
          createdAt: now,
          updatedAt: now,
          requesterReadAt: now,
        }),
      );
    }
    return ids;
  },
});
export const decide = mutation({
  args: {
    requestId: v.id('planReviewRequests'),
    decision: v.union(v.literal('approved'), v.literal('changes_requested')),
    note: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(args.requestId);
    if (!row || row.reviewerId !== userId) throw new ConvexError('Review request not found');
    const plan = await requirePlan(ctx, row.planId, userId);
    if ((await effectiveReviewStatus(ctx, row, plan)) !== 'pending')
      throw new ConvexError(
        'This review is no longer pending. Request a new review for the current revision.',
      );
    if (args.note.length > 4000 || (args.decision === 'changes_requested' && !args.note.trim()))
      throw new ConvexError('Changes requested requires a note of at most 4000 characters');
    const now = Math.max(Date.now(), row.updatedAt + 1);
    await ctx.db.patch(row._id, {
      status: args.decision,
      decisionNote: args.note.trim(),
      updatedAt: now,
      reviewerReadAt: now,
    });
    return null;
  },
});
export const cancel = mutation({
  args: { requestId: v.id('planReviewRequests') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(args.requestId);
    if (!row || row.requesterId !== userId) throw new ConvexError('Review request not found');
    const plan = await requirePlan(ctx, row.planId, userId);
    if ((await effectiveReviewStatus(ctx, row, plan)) !== 'pending')
      throw new ConvexError('This review is no longer pending');
    const now = Math.max(Date.now(), row.updatedAt + 1);
    await ctx.db.patch(row._id, { status: 'cancelled', updatedAt: now, requesterReadAt: now });
    return null;
  },
});
export const markRead = mutation({
  args: { requestId: v.id('planReviewRequests') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(args.requestId);
    const review = row && (await dto(ctx, row, userId));
    if (!row || !review) throw new ConvexError('Review request not found');
    // Acknowledge the latest review event; any later event bumps updatedAt past it.
    await ctx.db.patch(
      row._id,
      userId === row.requesterId
        ? { requesterReadAt: row.updatedAt, requesterSeenStatus: review.status }
        : { reviewerReadAt: row.updatedAt, reviewerSeenStatus: review.status },
    );
    return null;
  },
});
export const forPlan = query({
  args: { planId: v.id('plans'), paginationOpts: paginationOptsValidator },
  returns: pageValidator,
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return emptyReviewPage();
    const userId = user._id;
    if (!(await readablePlan(ctx, args.planId, userId))) return emptyReviewPage();
    const result = await ctx.db
      .query('planReviewRequests')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('desc')
      .paginate({ ...args.paginationOpts, numItems: Math.min(5, args.paginationOpts.numItems) });
    const page = (await Promise.all(result.page.map((r) => dto(ctx, r, userId, true)))).filter(
      (r) => r !== null,
    );
    return { ...result, page };
  },
});
export const inbox = query({
  args: {
    direction: v.union(v.literal('assigned'), v.literal('sent')),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageValidator,
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return emptyReviewPage();
    const userId = user._id;
    const rows =
      args.direction === 'assigned'
        ? ctx.db
            .query('planReviewRequests')
            .withIndex('by_reviewer', (q) => q.eq('reviewerId', userId))
        : ctx.db
            .query('planReviewRequests')
            .withIndex('by_requester', (q) => q.eq('requesterId', userId));
    const result = await rows
      .order('desc')
      .paginate({ ...args.paginationOpts, numItems: Math.min(5, args.paginationOpts.numItems) });
    const page = (await Promise.all(result.page.map((r) => dto(ctx, r, userId)))).filter(
      (r) => r !== null,
    );
    return { ...result, page };
  },
});

/** Bounded cleanup after direct plan deletion. Missing plans are never returned in inboxes. */
export const deleteForPlan = internalMutation({
  args: { planId: v.id('plans') },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.planId)) return null;
    const rows = await ctx.db
      .query('planReviewRequests')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .take(100);
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    if (rows.length === 100)
      await ctx.scheduler.runAfter(0, internal.teamReviews.deleteForPlan, args);
    return null;
  },
});
