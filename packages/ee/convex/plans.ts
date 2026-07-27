import { ProFeature } from '@agendex/shared/types';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { type QueryCtx, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { deletePlanRelatedData } from './planDeletion';
import { normalizePlanSourcePath, planMatchesSource } from './planSourcePath';
import {
  dedupeVisiblePlans,
  dedupeSearchPlans,
  filterVisiblePlans,
  isVisiblePlan,
  metadataWithPlanValueAssessment,
} from './planVisibility';
import { ensureBaselinePlanVersion, planContentChanged, recordPlanVersion } from './planVersioning';
import { hasActiveSubscriptionForUserId } from './subscriptions';

export const publishPlan = mutation({
  args: {
    localPlanId: v.string(),
    agent: v.string(),
    title: v.string(),
    content: v.string(),
    format: v.string(),
    filePath: v.optional(v.string()),
    workspace: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const ownerId = user._id;
    const now = Date.now();

    const metadata = metadataWithPlanValueAssessment(args.metadata, {
      title: args.title,
      content: args.content,
    });

    const existing = await ctx.db
      .query('plans')
      .withIndex('by_owner_localPlanId', (q) =>
        q.eq('ownerId', ownerId).eq('localPlanId', args.localPlanId),
      )
      .first();

    if (existing) {
      if (!planContentChanged(existing, args)) {
        return existing._id;
      }

      await ensureBaselinePlanVersion(ctx, {
        ownerId,
        planId: existing._id,
        version: existing.version,
        snapshot: {
          title: existing.title,
          content: existing.content,
          format: existing.format,
          filePath: existing.filePath,
          workspace: existing.workspace,
          metadata: existing.metadata,
        },
        createdAt: existing.updatedAt,
      });

      const newVersion = existing.version + 1;
      const snapshot = {
        title: args.title,
        content: args.content,
        format: args.format,
        filePath: args.filePath,
        workspace: args.workspace,
        metadata,
      };
      await ctx.db.patch(existing._id, {
        agent: args.agent,
        ...snapshot,
        version: newVersion,
        updatedAt: now,
      });
      await recordPlanVersion(ctx, {
        ownerId,
        planId: existing._id,
        version: newVersion,
        snapshot,
        source: 'editor',
        createdAt: now,
      });
      return existing._id;
    }

    const planId = await ctx.db.insert('plans', {
      ownerId,
      localPlanId: args.localPlanId,
      agent: args.agent,
      title: args.title,
      content: args.content,
      format: args.format,
      filePath: args.filePath,
      workspace: args.workspace,
      metadata,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await recordPlanVersion(ctx, {
      ownerId,
      planId,
      version: 1,
      snapshot: {
        title: args.title,
        content: args.content,
        format: args.format,
        filePath: args.filePath,
        workspace: args.workspace,
        metadata,
      },
      source: 'editor',
      createdAt: now,
    });

    return planId;
  },
});

// Resolves whose plans `getMyPublishedPlans` returns: your own, unless you lack
// an active subscription but belong to a workspace whose owner has one — then
// you see that owner's plans. Preserves the pre-pagination branching exactly.
async function resolvePublishedPlansOwnerId(ctx: QueryCtx, userId: string): Promise<string> {
  const ownActive = await hasActiveSubscriptionForUserId(ctx, userId);
  if (ownActive) return userId;

  const membership = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_member', (q) => q.eq('memberId', userId))
    .first();
  if (membership) {
    const ownerActive = await hasActiveSubscriptionForUserId(ctx, membership.workspaceOwnerId);
    if (ownerActive) return membership.workspaceOwnerId;
  }
  return userId;
}

export const getMyPublishedPlans = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const ownerId = await resolvePublishedPlansOwnerId(ctx, user._id);

    // Paginate rather than `.collect()`: a single query must never read an
    // unbounded number of plans, nor exceed Convex's per-transaction read
    // limits as plan count/content grows (the byte limit binds well before the
    // doc limit, since each plan carries its full content). `useCloudPlans`
    // walks every page client-side, so full-set aggregation still works.
    // Post-filtering shrinks a page but leaves the cursor valid.
    const result = await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .order('desc')
      .paginate(args.paginationOpts);

    // Strip `content` from list items: the list UI renders only metadata, and
    // shipping every plan's full body makes each reactive page push cost
    // O(total content bytes) per client. The detail view hydrates content via
    // `getMyPlanContent`; content search runs server-side via `searchMyPlans`.
    // Note this trims the wire payload, not the DB read — the paginated read
    // above still counts full document bytes against the transaction limit.
    return {
      ...result,
      page: dedupeVisiblePlans(filterVisiblePlans(result.page)).map(
        ({ content: _content, ...plan }) => plan,
      ),
    };
  },
});

// Content for a single plan, fetched when the user opens it. Same access rules
// as `getPlan`, but returns null instead of throwing: this backs a reactive
// `useQuery` in the list UI, where a stale URL or a just-deleted plan must
// degrade to "no content", not crash to the error boundary. Takes a plain
// string and normalizes it so malformed ids (e.g. a local-mode id left in the
// URL when switching to cloud mode) can't fail argument validation.
export const getMyPlanContent = query({
  args: { planId: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const planId = ctx.db.normalizeId('plans', args.planId);
    if (!planId) return null;

    const plan = await ctx.db.get(planId);
    if (!plan) return null;

    if (plan.ownerId !== user._id) {
      const membership = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace_member', (q) =>
          q.eq('workspaceOwnerId', plan.ownerId).eq('memberId', user._id),
        )
        .first();
      if (!membership) return null;

      const ownerActive = await hasActiveSubscriptionForUserId(ctx, plan.ownerId);
      if (!ownerActive) return null;
    }

    if (!isVisiblePlan(plan)) return null;

    return { content: plan.content };
  },
});

// Cap on server-side content-search matches. Search results are read as full
// documents, so this bounds the transaction's read cost the same way the list
// page size does. Relevance ordering means the cap drops the weakest matches.
const CONTENT_SEARCH_MAX_RESULTS = 25;

// Full-text content search over the same plan set `getMyPublishedPlans`
// returns. List items no longer carry `content`, so the client can't substring
// match it; instead it unions these ids into its metadata-search results.
export const searchMyPlans = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, args) => {
    const term = args.searchTerm.trim();
    if (!term) return [];

    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const ownerId = await resolvePublishedPlansOwnerId(ctx, user._id);

    const matches = await ctx.db
      .query('plans')
      .withSearchIndex('search_content', (q) => q.search('content', term).eq('ownerId', ownerId))
      .take(CONTENT_SEARCH_MAX_RESULTS);

    return dedupeSearchPlans(filterVisiblePlans(matches)).map((plan) => plan._id);
  },
});

export const getPlan = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      const membership = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace_member', (q) =>
          q.eq('workspaceOwnerId', plan.ownerId).eq('memberId', user._id),
        )
        .first();

      if (!membership) {
        throw new ConvexError('Access denied');
      }

      const ownerActive = await hasActiveSubscriptionForUserId(ctx, plan.ownerId);
      if (!ownerActive) {
        throw new ConvexError('Access denied');
      }
    }

    if (!isVisiblePlan(plan)) {
      throw new ConvexError('Plan not found');
    }

    return plan;
  },
});

export const getPlanByShareToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const shareLink = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!shareLink) {
      throw new ConvexError('Invalid or revoked share link');
    }

    const plan = await ctx.db.get(shareLink.planId);
    if (!plan || !isVisiblePlan(plan)) {
      throw new ConvexError('Plan not found');
    }

    if (shareLink.passwordHash) {
      return { passwordRequired: true as const };
    }

    return plan;
  },
});

export const renamePlan = mutation({
  args: {
    planId: v.id('plans'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError('Title cannot be empty');
    }

    if (plan.title === title) {
      return;
    }

    await ctx.db.patch(args.planId, {
      title,
      updatedAt: Date.now(),
    });
  },
});

export const updatePlanContent = mutation({
  args: {
    planId: v.id('plans'),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    if (!planContentChanged(plan, args)) {
      return;
    }

    await ensureBaselinePlanVersion(ctx, {
      ownerId: user._id,
      planId: args.planId,
      version: plan.version,
      snapshot: {
        title: plan.title,
        content: plan.content,
        format: plan.format,
        filePath: plan.filePath,
        workspace: plan.workspace,
        metadata: plan.metadata,
      },
      createdAt: plan.updatedAt,
    });

    const newVersion = plan.version + 1;
    const now = Date.now();
    const metadata = metadataWithPlanValueAssessment(plan.metadata, {
      title: args.title,
      content: args.content,
    });
    const snapshot = {
      title: args.title,
      content: args.content,
      format: plan.format,
      filePath: plan.filePath,
      workspace: plan.workspace,
      metadata,
    };

    await ctx.db.patch(args.planId, {
      title: args.title,
      content: args.content,
      metadata,
      version: newVersion,
      updatedAt: now,
    });

    await recordPlanVersion(ctx, {
      ownerId: user._id,
      planId: args.planId,
      version: newVersion,
      snapshot,
      source: 'editor',
      createdAt: now,
    });
  },
});
export const deletePlan = mutation({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    await deletePlanRelatedData(ctx, { planId: args.planId, ownerId: user._id });

    await ctx.db.delete(args.planId);
  },
});

/**
 * Related-data cleanup fans out several deletes per plan, so keep each
 * transaction well within Convex write limits.
 */
const DELETE_SOURCE_BATCH_SIZE = 25;

/**
 * Deletes a bounded batch of the caller's plans synced from one custom source
 * dir. Callers repeat until `done` is true: matching server-side covers rows
 * beyond whatever page of plans the client has loaded, and the batch bound
 * keeps each call inside transaction limits for large sources.
 */
export const deleteMyPlansBySource = mutation({
  args: { customDir: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.CLOUD_SYNC);

    const target = normalizePlanSourcePath(args.customDir);
    if (!target) {
      throw new ConvexError('customDir is required');
    }

    const matches: Array<Id<'plans'>> = [];
    let scanComplete = true;
    for await (const plan of ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))) {
      if (!planMatchesSource(plan.metadata, target)) continue;
      matches.push(plan._id);
      if (matches.length >= DELETE_SOURCE_BATCH_SIZE) {
        scanComplete = false;
        break;
      }
    }

    for (const planId of matches) {
      await deletePlanRelatedData(ctx, { planId, ownerId: user._id });
      await ctx.db.delete(planId);
    }

    return { deleted: matches.length, done: scanComplete };
  },
});
