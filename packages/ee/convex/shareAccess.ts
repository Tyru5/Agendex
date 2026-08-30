import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { isVisiblePlan } from './planVisibility';

export const shareAccessProofIdValidator = v.id('shareAccessProofs');

export const SHARE_ACCESS_PROOF_TTL_MS = 15 * 60 * 1000;

type ShareAccessProofState = Pick<Doc<'shareAccessProofs'>, 'shareLinkId' | 'expiresAt'>;

export type ShareAccessDecision =
  | { kind: 'authorized' }
  | { kind: 'password_required'; reason: 'missing' | 'invalid' | 'expired' }
  | { kind: 'denied'; reason: 'revoked' };

export function evaluateShareAccessPolicy({
  shareLinkId,
  passwordProtected,
  accessProof,
  now,
}: {
  shareLinkId: Id<'shareLinks'> | null;
  passwordProtected: boolean;
  accessProof: ShareAccessProofState | null;
  now: number;
}): ShareAccessDecision {
  if (!shareLinkId) {
    return { kind: 'denied', reason: 'revoked' };
  }

  if (!passwordProtected) {
    return { kind: 'authorized' };
  }

  if (!accessProof) {
    return { kind: 'password_required', reason: 'missing' };
  }

  if (accessProof.shareLinkId !== shareLinkId) {
    return { kind: 'password_required', reason: 'invalid' };
  }

  if (accessProof.expiresAt <= now) {
    return { kind: 'password_required', reason: 'expired' };
  }

  return { kind: 'authorized' };
}

type ShareAccessCtx = Pick<QueryCtx, 'db'>;

type SharedPlanAccessArgs = {
  token: string;
  planId?: Id<'plans'>;
  accessProof?: Id<'shareAccessProofs'>;
};

export type SharedPlanAccess =
  | {
      kind: 'authorized';
      shareLink: Doc<'shareLinks'>;
      plan: Doc<'plans'>;
    }
  | {
      kind: 'password_required';
      reason: 'missing' | 'invalid' | 'expired';
      shareLink: Doc<'shareLinks'>;
      plan: Doc<'plans'>;
    };

/**
 * Resolves every public share credential through one policy. A raw share token
 * authorizes unprotected links. Password-protected links additionally require
 * a live proof issued for that exact share-link document.
 */
export async function resolveSharedPlanAccess(
  ctx: ShareAccessCtx,
  args: SharedPlanAccessArgs,
): Promise<SharedPlanAccess> {
  const shareLink = await ctx.db
    .query('shareLinks')
    .withIndex('by_token', (q) => q.eq('token', args.token))
    .first();

  const now = Date.now();
  const linkDecision = evaluateShareAccessPolicy({
    shareLinkId: shareLink?._id ?? null,
    passwordProtected: shareLink?.passwordHash !== undefined,
    accessProof: null,
    now,
  });
  if (
    linkDecision.kind === 'denied' ||
    !shareLink ||
    (args.planId !== undefined && shareLink.planId !== args.planId)
  ) {
    throw new ConvexError('Invalid or revoked share link');
  }

  const plan = await ctx.db.get(shareLink.planId);
  if (!plan || !isVisiblePlan(plan)) {
    throw new ConvexError('Plan not found');
  }

  const accessProof = args.accessProof ? await ctx.db.get(args.accessProof) : null;
  const decision = evaluateShareAccessPolicy({
    shareLinkId: shareLink._id,
    passwordProtected: shareLink.passwordHash !== undefined,
    accessProof,
    now,
  });

  if (decision.kind === 'authorized') {
    return { kind: 'authorized', shareLink, plan };
  }

  if (decision.kind === 'denied') {
    throw new ConvexError('Invalid or revoked share link');
  }

  return { kind: 'password_required', reason: decision.reason, shareLink, plan };
}

/** Requires full shared-plan access for comments, uploads, and linked resources. */
export async function requireSharedPlanAccess(
  ctx: ShareAccessCtx,
  args: SharedPlanAccessArgs,
): Promise<{ shareLink: Doc<'shareLinks'>; plan: Doc<'plans'> }> {
  const access = await resolveSharedPlanAccess(ctx, args);
  if (access.kind === 'authorized') {
    return access;
  }

  if (access.reason === 'expired') {
    throw new ConvexError('Share access proof expired');
  }
  if (access.reason === 'invalid') {
    throw new ConvexError('Invalid share access proof');
  }
  throw new ConvexError('Share access proof required');
}
