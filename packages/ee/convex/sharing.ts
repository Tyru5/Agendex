import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_HASH_PREFIX = 'p2';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

async function pbkdf2Sha256(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2Sha256(password, salt);
  return `${PBKDF2_HASH_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(derived)}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== PBKDF2_HASH_PREFIX) return false;
  const iterations = Number(parts[1]);
  if (iterations !== PBKDF2_ITERATIONS) return false;
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  if (!salt || !expected || expected.length !== 32) return false;

  const derived = await pbkdf2Sha256(password, salt);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) {
    diff |= derived[i] ^ expected[i];
  }
  return diff === 0;
}

export const createShareLink = mutation({
  args: {
    planId: v.id('plans'),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.SHARE_LINKS);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const token = `${crypto.randomUUID()}-${Date.now().toString(36)}`;

    let passwordHash: string | undefined;
    if (args.password && args.password.length > 0) {
      passwordHash = await hashPassword(args.password);
    }

    await ctx.db.insert('shareLinks', {
      planId: args.planId,
      token,
      createdBy: user._id,
      createdAt: Date.now(),
      passwordHash,
    });

    return token;
  },
});

export const revokeShareLink = mutation({
  args: { shareLinkId: v.id('shareLinks') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.SHARE_LINKS);

    const shareLink = await ctx.db.get(args.shareLinkId);
    if (!shareLink) {
      throw new ConvexError('Share link not found');
    }

    const plan = await ctx.db.get(shareLink.planId);
    if (!plan || plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    await ctx.db.delete(args.shareLinkId);
  },
});

export const getShareLinks = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.SHARE_LINKS);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    const links = await ctx.db
      .query('shareLinks')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .collect();

    return links.map((link) => ({
      _id: link._id,
      token: link.token,
      createdAt: link.createdAt,
      hasPassword: !!link.passwordHash,
    }));
  },
});

export const getShareLinkAndPlanInternal = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const shareLink = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!shareLink) return null;

    const plan = await ctx.db.get(shareLink.planId);
    if (!plan) return null;

    return { shareLink, plan };
  },
});

export const getSharedPlanWithPassword = action({
  args: { token: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(internal.sharing.getShareLinkAndPlanInternal, {
      token: args.token,
    });

    if (!result) {
      throw new ConvexError('Invalid or revoked share link');
    }

    const { shareLink, plan } = result;

    if (!shareLink.passwordHash) {
      return plan;
    }

    const valid = await verifyPassword(args.password, shareLink.passwordHash);
    if (!valid) {
      throw new ConvexError('Incorrect password');
    }

    return plan;
  },
});
