import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID();
  const data = new TextEncoder().encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${salt}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const data = new TextEncoder().encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hashHex === hash;
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
