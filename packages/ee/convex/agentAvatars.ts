import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from './_generated/server';
import {
  AVATAR_UPLOAD_RESERVATION_TTL_MS,
  MAX_AGENT_NAME_LENGTH,
  validateAvatarStorageClaim,
} from './avatarUploadPolicy';
import { authComponent } from './auth';
import { hasAnyStorageReference, inspectStorageReferences } from './storageReferences';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_AVATAR_TYPES: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'image/gif': true,
};
const MAX_STALE_RESERVATIONS_PER_CLEANUP = 500;

function validateAgent(agent: string): string {
  const normalized = agent.trim().toLowerCase();
  if (!normalized) throw new ConvexError('Agent is required');
  if (normalized.length > MAX_AGENT_NAME_LENGTH) {
    throw new ConvexError(`Agent must be at most ${MAX_AGENT_NAME_LENGTH} characters`);
  }
  return normalized;
}

async function deleteStorageFile(
  ctx: Pick<MutationCtx, 'storage'>,
  storageId: Id<'_storage'>,
): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // The owned storage object may already have been deleted.
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
    .take(100);

  const result: Record<string, string> = {};
  for (const avatar of avatars) {
    const url = await ctx.storage.getUrl(avatar.storageId);
    if (url) result[avatar.agent] = url;
  }
  return result;
}

async function deleteAvatarStorageIfUnreferenced(
  ctx: Pick<MutationCtx, 'db' | 'storage'>,
  avatar: Pick<Doc<'agentAvatars'>, '_id' | 'storageId'>,
): Promise<void> {
  const references = await inspectStorageReferences(ctx, avatar.storageId, {
    excludeAvatarId: avatar._id,
  });
  if (!hasAnyStorageReference(references)) {
    await deleteStorageFile(ctx, avatar.storageId);
  }
}

export async function getAgentAvatarStorageIdsForOwner(
  ctx: Pick<QueryCtx, 'db'>,
  ownerId: string,
): Promise<Set<Id<'_storage'>>> {
  const avatars = await ctx.db
    .query('agentAvatars')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .collect();
  return new Set(avatars.map((avatar) => avatar.storageId));
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
  const reservations = await ctx.db
    .query('agentAvatarUploadReservations')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .collect();
  for (const reservation of reservations) {
    await ctx.db.delete(reservation._id);
  }

  const avatars = await ctx.db
    .query('agentAvatars')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .collect();
  for (const avatar of avatars) {
    await deleteAvatarStorageIfUnreferenced(ctx, avatar);
    await ctx.db.delete(avatar._id);
  }
}

export const listMyAgentAvatars = query({
  args: {},
  returns: v.record(v.string(), v.string()),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return {};
    return await buildAvatarUrlMap(ctx, user._id);
  },
});

export const listAgentAvatarsForShare = query({
  args: { token: v.string() },
  returns: v.record(v.string(), v.string()),
  handler: async (ctx, args) => {
    const shareLink = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
    if (!shareLink) return {};
    const plan = await ctx.db.get(shareLink.planId);
    if (!plan) return {};
    return await buildAvatarUrlMap(ctx, plan.ownerId);
  },
});

export const generateAgentAvatarUploadUrl = mutation({
  args: { agent: v.string() },
  returns: v.object({
    uploadUrl: v.string(),
    reservationId: v.id('agentAvatarUploadReservations'),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const agent = validateAgent(args.agent);
    const now = Date.now();
    const existing = await ctx.db
      .query('agentAvatarUploadReservations')
      .withIndex('by_owner_agent', (q) => q.eq('ownerId', user._id).eq('agent', agent))
      .first();

    let reservationId: Id<'agentAvatarUploadReservations'>;
    let expiresAt: number;
    if (existing && existing.expiresAt >= now) {
      reservationId = existing._id;
      expiresAt = existing.expiresAt;
    } else {
      if (existing) await ctx.db.delete(existing._id);
      expiresAt = now + AVATAR_UPLOAD_RESERVATION_TTL_MS;
      reservationId = await ctx.db.insert('agentAvatarUploadReservations', {
        ownerId: user._id,
        agent,
        createdAt: now,
        expiresAt,
      });
    }

    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      reservationId,
      expiresAt,
    };
  },
});

export const setAgentAvatar = mutation({
  args: {
    agent: v.string(),
    storageId: v.id('_storage'),
    reservationId: v.id('agentAvatarUploadReservations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const agent = validateAgent(args.agent);
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) throw new ConvexError('Avatar upload reservation not found');
    if (reservation.ownerId !== user._id) {
      throw new ConvexError('Avatar upload reservation belongs to another user');
    }
    if (reservation.agent !== agent) {
      throw new ConvexError('Avatar upload reservation is for another agent');
    }

    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) throw new ConvexError('Uploaded image not found');

    const references = await inspectStorageReferences(ctx, args.storageId);
    const rejection = validateAvatarStorageClaim({
      callerId: user._id,
      agent,
      now: Date.now(),
      reservation,
      storageCreatedAt: metadata._creationTime,
      references,
    });
    if (rejection === 'reservation_expired') {
      throw new ConvexError('Avatar upload reservation expired');
    }
    if (rejection === 'storage_predates_reservation') {
      throw new ConvexError('Storage ID was not uploaded for this avatar reservation');
    }
    if (rejection === 'storage_created_after_reservation') {
      throw new ConvexError('Storage ID was uploaded after this avatar reservation expired');
    }
    if (rejection === 'storage_referenced') {
      throw new ConvexError('Storage ID is already owned or referenced');
    }
    if (rejection) {
      throw new ConvexError('Invalid avatar upload reservation');
    }

    if (!metadata.contentType || !ALLOWED_AVATAR_TYPES[metadata.contentType]) {
      throw new ConvexError(
        `File type "${metadata.contentType ?? 'unknown'}" is not allowed. Use JPEG, PNG, WebP, or GIF.`,
      );
    }
    if (metadata.size > MAX_AVATAR_BYTES) {
      throw new ConvexError('Avatar must be under 2MB');
    }

    const existing = await findAvatar(ctx, user._id, agent);
    if (existing) {
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
    await ctx.db.delete(reservation._id);

    if (existing && existing.storageId !== args.storageId) {
      await deleteAvatarStorageIfUnreferenced(ctx, existing);
    }
    return null;
  },
});

export const removeAgentAvatar = mutation({
  args: { agent: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const agent = validateAgent(args.agent);
    const existing = await findAvatar(ctx, user._id, agent);
    if (!existing) return null;

    await deleteAvatarStorageIfUnreferenced(ctx, existing);
    await ctx.db.delete(existing._id);
    return null;
  },
});

export const cleanupStaleAgentAvatarUploadReservations = internalMutation({
  args: {},
  returns: v.object({ deletedReservations: v.number() }),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query('agentAvatarUploadReservations')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', Date.now()))
      .take(MAX_STALE_RESERVATIONS_PER_CLEANUP);

    for (const reservation of expired) {
      await ctx.db.delete(reservation._id);
    }
    return { deletedReservations: expired.length };
  },
});
