import {
  extractPlanGitContext,
  type GitRepoInfo,
  normalizePlanGitLink,
} from '@agendex/shared/git-forge';
import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, type QueryCtx, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature, requireFeatureForUserId } from './entitlements';
import {
  requireSharedPlanAccess,
  shareAccessProofIdValidator,
} from './shareAccess';

const MAX_LINKS_PER_PLAN = 20;

const planGitLinkType = v.union(v.literal('branch'), v.literal('commit'), v.literal('pr'));

const planGitLinkDoc = v.object({
  _id: v.id('planLinks'),
  _creationTime: v.number(),
  ownerId: v.string(),
  planId: v.id('plans'),
  type: planGitLinkType,
  value: v.string(),
  url: v.optional(v.string()),
  createdAt: v.number(),
});


/**
 * Read access for git links:
 * - plan owner with GIT_LINKS entitlement
 * - workspace member of an owner with an active subscription (dashboard)
 * - authorized share access (public shared plan view)
 */
async function validatePlanLinkReadAccess(
  ctx: QueryCtx,
  planId: Id<'plans'>,
  token: string | undefined,
  accessProof: Id<'shareAccessProofs'> | undefined,
): Promise<void> {
  const plan = await ctx.db.get(planId);
  if (!plan) throw new ConvexError('Plan not found');

  const user = await authComponent.safeGetAuthUser(ctx);
  if (user && plan.ownerId === user._id) {
    await requireFeature(ctx, ProFeature.GIT_LINKS);
    return;
  }

  if (user) {
    const membership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace_member', (q) =>
        q.eq('workspaceOwnerId', plan.ownerId).eq('memberId', user._id),
      )
      .first();
    if (membership) {
      await requireFeatureForUserId(ctx, plan.ownerId, ProFeature.GIT_LINKS);
      return;
    }
  }

  if (!token) throw new ConvexError('Share token required');
  await requireSharedPlanAccess(ctx, {
    planId,
    token,
    ...(accessProof ? { accessProof } : {}),
  });
}

/** Only the plan owner (with an active subscription) may add or remove links. */
async function requireOwnedPlan(ctx: QueryCtx, planId: Id<'plans'>): Promise<Doc<'plans'>> {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new ConvexError('Unauthenticated');

  const plan = await ctx.db.get(planId);
  if (!plan) throw new ConvexError('Plan not found');
  if (plan.ownerId !== user._id) throw new ConvexError('Access denied');

  await requireFeature(ctx, ProFeature.GIT_LINKS);
  return plan;
}

function planRepoInfo(plan: Doc<'plans'>): GitRepoInfo | undefined {
  return extractPlanGitContext(plan.metadata)?.repo;
}

export const getLinks = query({
  args: {
    planId: v.id('plans'),
    token: v.optional(v.string()),
    accessProof: v.optional(shareAccessProofIdValidator),
  },
  returns: v.array(planGitLinkDoc),
  handler: async (ctx, args) => {
    await validatePlanLinkReadAccess(ctx, args.planId, args.token, args.accessProof);

    return await ctx.db
      .query('planLinks')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('asc')
      .take(MAX_LINKS_PER_PLAN);
  },
});

export const addLink = mutation({
  args: { planId: v.id('plans'), input: v.string() },
  returns: planGitLinkDoc,
  handler: async (ctx, args) => {
    const plan = await requireOwnedPlan(ctx, args.planId);

    const normalized = normalizePlanGitLink(args.input, planRepoInfo(plan));
    if (!normalized.ok) throw new ConvexError(normalized.error);
    const { link } = normalized;

    const existing = await ctx.db
      .query('planLinks')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .take(MAX_LINKS_PER_PLAN);
    if (existing.length >= MAX_LINKS_PER_PLAN) {
      throw new ConvexError(`A plan can have at most ${MAX_LINKS_PER_PLAN} git links`);
    }
    const duplicate = existing.find(
      (candidate) => candidate.type === link.type && candidate.value === link.value,
    );
    if (duplicate) throw new ConvexError('This link is already attached to the plan');

    const linkId = await ctx.db.insert('planLinks', {
      ownerId: plan.ownerId,
      planId: args.planId,
      type: link.type,
      value: link.value,
      ...(link.url && { url: link.url }),
      createdAt: Date.now(),
    });

    const created = await ctx.db.get(linkId);
    if (!created) throw new ConvexError('Failed to create link');
    return created;
  },
});

export const deleteLink = mutation({
  args: { linkId: v.id('planLinks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new ConvexError('Link not found');

    await requireOwnedPlan(ctx, link.planId);
    await ctx.db.delete(args.linkId);
    return null;
  },
});
