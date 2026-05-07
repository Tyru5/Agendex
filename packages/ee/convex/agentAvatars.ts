import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { type MutationCtx, mutation, type QueryCtx, query } from './_generated/server';
import { authComponent } from './auth';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase();
}

async function deleteStorageFile(
  ctx: Pick<MutationCtx, 'storage'>,
  storageId: Id<'_storage'>,
): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // Storage file may already be deleted; continue.
  }
}

async function findAvatar(
  ctx: Pick<QueryCtx, 'db'>,
  ownerId: string,
  agent: string,
): Promise<Doc<'agentAvatars'> | null> {
  return await ctx.db
    .query('agentAvatars')
    .withIndex('by_owner_agent', (q) => q.eq('ownerId', ownerId).eq('agent', agent))
    .first();
}

async function buildAvatarUrlMap(
  ctx: Pick<QueryCtx, 'db' | 'storage'>,
  ownerId: string,
): Promise<Record<string, string>> {
  const avatars = await ctx.db
    .query('agentAvatars')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .collect();

  const result: Record<string, string> = {};
  for (const avatar of avatars) {
    const url = await ctx.storage.getUrl(avatar.storageId);
    if (url) result[avatar.agent] = url;
  }
  return result;
}

export async function getAgentAvatarStorageIdsForOwner(
  ctx: Pick<QueryCtx, 'db'>,
  ownerId: string,
): Promise<Set<Id<'_storage'>>> {
  const avatars = await ctx.db
    .query('agentAvatars')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .collect();
  return new Set(avatars.map((a) => a.storageId));
}

export async function isAgentAvatarStorageId(
  ctx: Pick<QueryCtx, 'db'>,
  storageId: Id<'_storage'>,
): Promise<boolean> {
  const avatar = await ctx.db
    .query('agentAvatars')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .first();
  return avatar !== null;
}

export async function deleteAllAgentAvatarsForOwner(
  ctx: Pick<MutationCtx, 'db' | 'storage'>,
  ownerId: string,
): Promise<void> {
  const avatars = await ctx.db
    .query('agentAvatars')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .collect();
  for (const avatar of avatars) {
    await deleteStorageFile(ctx, avatar.storageId);
    await ctx.db.delete(avatar._id);
  }
}

export const listMyAgentAvatars = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return {} as Record<string, string>;
    return await buildAvatarUrlMap(ctx, user._id);
  },
});

export const listAgentAvatarsForShare = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const shareLink = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
    if (!shareLink) return {} as Record<string, string>;
    const plan = await ctx.db.get(shareLink.planId);
    if (!plan) return {} as Record<string, string>;
    return await buildAvatarUrlMap(ctx, plan.ownerId);
  },
});

export const generateAgentAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    return await ctx.storage.generateUploadUrl();
  },
});

export const setAgentAvatar = mutation({
  args: {
    agent: v.string(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const agent = normalizeAgent(args.agent);
    if (!agent) throw new ConvexError('Agent is required');

    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) {
      throw new ConvexError('Uploaded image not found');
    }

    if (!metadata.contentType || !ALLOWED_AVATAR_TYPES.has(metadata.contentType)) {
      // Drop the orphan blob since we are rejecting it.
      await deleteStorageFile(ctx, args.storageId);
      throw new ConvexError(
        `File type "${metadata.contentType ?? 'unknown'}" is not allowed. Use JPEG, PNG, WebP, or GIF.`,
      );
    }

    if (metadata.size > MAX_AVATAR_BYTES) {
      await deleteStorageFile(ctx, args.storageId);
      throw new ConvexError('Avatar must be under 2MB');
    }

    const existing = await findAvatar(ctx, user._id, agent);
    if (existing) {
      // Delete the previous blob, then update the row in the same transaction.
      if (existing.storageId !== args.storageId) {
        await deleteStorageFile(ctx, existing.storageId);
      }
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert('agentAvatars', {
        ownerId: user._id,
        agent,
        storageId: args.storageId,
        updatedAt: Date.now(),
      });
    }
  },
});

export const removeAgentAvatar = mutation({
  args: { agent: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const agent = normalizeAgent(args.agent);
    const existing = await findAvatar(ctx, user._id, agent);
    if (!existing) return;

    await deleteStorageFile(ctx, existing.storageId);
    await ctx.db.delete(existing._id);
  },
});
