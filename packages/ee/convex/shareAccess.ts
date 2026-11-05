import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { isVisiblePlan } from './planVisibility';

/**
 * Opaque bearer credential issued after a share password is verified:
 * `<shareAccessProofs id>.<base64url 32-byte secret>`. Only the secret's
 * SHA-256 hash is stored, so a proof document id alone grants nothing.
 */
export const shareAccessProofValidator = v.string();

export const SHARE_ACCESS_PROOF_SECRET_BYTES = 32;

export const SHARE_ACCESS_PROOF_TTL_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner-selectable share-link lifetimes; `never` keeps the link until revoked. */
export const SHARE_LINK_EXPIRY_MS = {
  never: null,
  '1d': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
} as const;

export type ShareLinkExpiry = keyof typeof SHARE_LINK_EXPIRY_MS;

export const shareLinkExpiryValidator = v.union(
  v.literal('never'),
  v.literal('1d'),
  v.literal('7d'),
  v.literal('30d'),
);

export function shareLinkExpiresAt(expiry: ShareLinkExpiry, now: number): number | undefined {
  const ttl = SHARE_LINK_EXPIRY_MS[expiry];
  return ttl === null ? undefined : now + ttl;
}

/** Expired links are treated exactly like revoked (missing) links. */
export function isShareLinkLive(
  shareLink: Pick<Doc<'shareLinks'>, 'expiresAt'> | null,
  now: number,
): boolean {
  return shareLink !== null && (shareLink.expiresAt === undefined || shareLink.expiresAt > now);
}

type ShareAccessProofState = Pick<Doc<'shareAccessProofs'>, 'shareLinkId' | 'expiresAt'>;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashShareAccessProofSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return bytesToHex(new Uint8Array(digest));
}

/** Actions only: needs real randomness, which deterministic queries/mutations lack. */
export async function generateShareAccessProofSecret(): Promise<{
  secret: string;
  secretHash: string;
}> {
  const secret = bytesToBase64Url(
    crypto.getRandomValues(new Uint8Array(SHARE_ACCESS_PROOF_SECRET_BYTES)),
  );
  return { secret, secretHash: await hashShareAccessProofSecret(secret) };
}

export function formatShareAccessProof(proofId: Id<'shareAccessProofs'>, secret: string): string {
  return `${proofId}.${secret}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Loads the proof a credential names, or null when it is malformed, unknown,
 * or its secret does not match. Callers treat null as an invalid proof.
 */
async function loadVerifiedShareAccessProof(
  ctx: ShareAccessCtx,
  credential: string,
): Promise<Doc<'shareAccessProofs'> | null> {
  const separator = credential.indexOf('.');
  if (separator <= 0) return null;
  const proofId = ctx.db.normalizeId('shareAccessProofs', credential.slice(0, separator));
  const secret = credential.slice(separator + 1);
  if (!proofId || !secret) return null;

  const proof = await ctx.db.get(proofId);
  if (!proof?.secretHash) return null;
  const secretHash = await hashShareAccessProofSecret(secret);
  return constantTimeEqual(secretHash, proof.secretHash) ? proof : null;
}

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
  accessProof?: string;
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

/** Why a share link cannot be opened at all (as opposed to needing a password). */
export type SharedPlanUnavailable = {
  kind: 'unavailable';
  reason: 'revoked' | 'plan_not_found';
};

/**
 * Non-throwing variant for read-only queries that render share pages: revoked,
 * expired, and mismatched links resolve to `unavailable` instead of throwing.
 */
export async function findSharedPlanAccess(
  ctx: ShareAccessCtx,
  args: SharedPlanAccessArgs,
): Promise<SharedPlanAccess | SharedPlanUnavailable> {
  const now = Date.now();
  const found = await ctx.db
    .query('shareLinks')
    .withIndex('by_token', (q) => q.eq('token', args.token))
    .first();
  const shareLink = found && isShareLinkLive(found, now) ? found : null;

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
    return { kind: 'unavailable', reason: 'revoked' };
  }

  const plan = await ctx.db.get(shareLink.planId);
  if (!plan || !isVisiblePlan(plan)) {
    return { kind: 'unavailable', reason: 'plan_not_found' };
  }

  const accessProof = args.accessProof
    ? await loadVerifiedShareAccessProof(ctx, args.accessProof)
    : null;
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
    return { kind: 'unavailable', reason: 'revoked' };
  }

  // A credential was supplied but did not verify: report it as invalid, not missing.
  const reason = args.accessProof && !accessProof ? 'invalid' : decision.reason;
  return { kind: 'password_required', reason, shareLink, plan };
}

/**
 * Resolves every public share credential through one policy. A raw share token
 * authorizes unprotected links. Password-protected links additionally require
 * a live proof issued for that exact share-link document. Throws when the link
 * is revoked, expired, or its plan is gone.
 */
export async function resolveSharedPlanAccess(
  ctx: ShareAccessCtx,
  args: SharedPlanAccessArgs,
): Promise<SharedPlanAccess> {
  const access = await findSharedPlanAccess(ctx, args);
  if (access.kind === 'unavailable') {
    throw new ConvexError(
      access.reason === 'revoked' ? 'Invalid or revoked share link' : 'Plan not found',
    );
  }
  return access;
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
