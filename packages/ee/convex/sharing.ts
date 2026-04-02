import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { api, internal } from './_generated/api';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

async function hashPassword(password: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PASSWORD_PBKDF2_ITERATIONS,
      salt,
    },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8,
  );

  const hash = new Uint8Array(derivedBits);
  return `pbkdf2-sha256:${PASSWORD_PBKDF2_ITERATIONS}:${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('pbkdf2-sha256:')) {
    const [algorithm, iterationsRaw, saltHex, expectedHashHex] = storedHash.split(':');
    if (algorithm !== 'pbkdf2-sha256' || !iterationsRaw || !saltHex || !expectedHashHex) {
      return false;
    }

    const iterations = Number.parseInt(iterationsRaw, 10);
    if (!Number.isFinite(iterations) || iterations < 1) {
      return false;
    }

    const salt = hexToBytes(saltHex);
    const expectedHash = hexToBytes(expectedHashHex);
    if (!salt || !expectedHash) {
      return false;
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations,
        salt,
      },
      keyMaterial,
      expectedHash.length * 8,
    );
    const actualHash = new Uint8Array(derivedBits);
    return constantTimeEqualBytes(actualHash, expectedHash);
  }

  // Backward compatibility for links hashed before PBKDF2 rollout.
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const data = new TextEncoder().encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = bytesToHex(new Uint8Array(hashBuffer));
  return constantTimeEqualHex(hashHex, hash);
}

const PASSWORD_PBKDF2_ITERATIONS = 210_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

export const createShareLink = action({
  args: {
    planId: v.id('plans'),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const hasShareLinks = await ctx.runQuery(api.subscriptions.isProUser);
    if (!hasShareLinks) {
      throw new ConvexError(
        `Cloud Pro subscription required for feature: ${ProFeature.SHARE_LINKS}`,
      );
    }

    await ctx.runQuery(api.plans.getPlan, { planId: args.planId });

    const token = `${crypto.randomUUID()}-${Date.now().toString(36)}`;

    let passwordHash: string | undefined;
    if (args.password && args.password.length > 0) {
      passwordHash = await hashPassword(args.password);
    }

    await ctx.runMutation(internal.sharing.createShareLinkInternal, {
      planId: args.planId,
      token,
      createdBy: user._id,
      passwordHash,
    });
    return token;
  },
});

export const createShareLinkInternal = internalMutation({
  args: {
    planId: v.id('plans'),
    token: v.string(),
    createdBy: v.string(),
    passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== args.createdBy) {
      throw new ConvexError('Access denied');
    }

    await ctx.db.insert('shareLinks', {
      planId: args.planId,
      token: args.token,
      createdBy: args.createdBy,
      createdAt: Date.now(),
      passwordHash: args.passwordHash,
    });
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
