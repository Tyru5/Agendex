import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internalMutation, mutation, type QueryCtx, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

const MAX_COMMENT_IMAGE_COUNT = 4;
const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_COMMENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function validateShareToken(ctx: QueryCtx, planId: string, token: string): Promise<void> {
  const shareLink = await ctx.db
    .query('shareLinks')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();

  if (!shareLink || shareLink.revokedAt || shareLink.planId !== planId) {
    throw new ConvexError('Invalid or revoked share token');
  }
}

async function validateCommentAccess(
  ctx: QueryCtx,
  planId: Id<'plans'>,
  token: string | undefined,
): Promise<void> {
  const plan = await ctx.db.get(planId);
  if (!plan) throw new ConvexError('Plan not found');

  const user = await authComponent.safeGetAuthUser(ctx);
  const isOwner = user && plan.ownerId === user._id;

  if (isOwner) {
    await requireFeature(ctx, ProFeature.COMMENTS);
  } else {
    if (!token) throw new ConvexError('Share token required');
    await validateShareToken(ctx, planId, token);
  }
}

export const getComments = query({
  args: { planId: v.id('plans'), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await validateCommentAccess(ctx, args.planId, args.token);

    const comments = await ctx.db
      .query('comments')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('asc')
      .collect();

    return await Promise.all(
      comments.map(async (comment) => ({
        ...comment,
        attachments: await Promise.all(
          (comment.attachments ?? []).map(async (attachment) => {
            const url = await ctx.storage.getUrl(attachment.storageId);
            if (!url) return null;
            return { ...attachment, url };
          }),
        ).then((results) => results.filter((a) => a !== null)),
      })),
    );
  },
});

export const generateCommentImageUploadUrl = mutation({
  args: {
    planId: v.id('plans'),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError('Plan not found');

    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else {
      if (!args.token) throw new ConvexError('Share token required');
      await validateShareToken(ctx, args.planId, args.token);
    }

    return await ctx.storage.generateUploadUrl();
  },
});

export const trackPendingUpload = mutation({
  args: {
    storageId: v.id('_storage'),
    planId: v.id('plans'),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError('Plan not found');

    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else {
      if (!args.token) throw new ConvexError('Share token required');
      await validateShareToken(ctx, args.planId, args.token);
    }

    const existing = await ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .first();
    if (existing) {
      throw new ConvexError('Storage ID already claimed');
    }

    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) throw new ConvexError('File not found');
    const MAX_UPLOAD_AGE_MS = 5 * 60 * 1000;
    if (Date.now() - metadata._creationTime > MAX_UPLOAD_AGE_MS) {
      throw new ConvexError('Upload expired');
    }

    if (!metadata.contentType || !ALLOWED_COMMENT_IMAGE_TYPES.has(metadata.contentType)) {
      await ctx.storage.delete(args.storageId);
      return {
        success: false as const,
        error: `File type "${metadata.contentType ?? 'unknown'}" is not allowed. Use JPEG, PNG, WebP, or GIF.`,
      };
    }
    if (metadata.size > MAX_COMMENT_IMAGE_BYTES) {
      await ctx.storage.delete(args.storageId);
      return { success: false as const, error: 'Image must be under 5MB' };
    }

    await ctx.db.insert('pendingUploads', {
      storageId: args.storageId,
      uploadedBy: user._id,
      planId: args.planId,
      createdAt: Date.now(),
    });
    return { success: true as const };
  },
});

export const addComment = mutation({
  args: {
    planId: v.id('plans'),
    body: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          fileName: v.optional(v.string()),
        }),
      ),
    ),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else {
      if (!args.token) throw new ConvexError('Share token required');
      await validateShareToken(ctx, args.planId, args.token);
    }

    const trimmedBody = args.body.trim();
    const incomingAttachments = args.attachments ?? [];

    if (!trimmedBody && incomingAttachments.length === 0) {
      throw new ConvexError('Comment must have text or at least one image');
    }

    if (incomingAttachments.length > MAX_COMMENT_IMAGE_COUNT) {
      throw new ConvexError(`Maximum ${MAX_COMMENT_IMAGE_COUNT} images per comment`);
    }

    const validatedAttachments = await Promise.all(
      incomingAttachments.map(async (attachment) => {
        const pending = await ctx.db
          .query('pendingUploads')
          .withIndex('by_user_storage', (q) =>
            q.eq('uploadedBy', user._id).eq('storageId', attachment.storageId),
          )
          .first();
        if (!pending) {
          throw new ConvexError('You do not own this upload');
        }

        const metadata = await ctx.db.system.get(attachment.storageId);
        if (!metadata) {
          throw new ConvexError('Uploaded file not found');
        }

        if (!metadata.contentType || !ALLOWED_COMMENT_IMAGE_TYPES.has(metadata.contentType)) {
          throw new ConvexError(
            `File type "${metadata.contentType ?? 'unknown'}" is not allowed. Use JPEG, PNG, WebP, or GIF.`,
          );
        }

        if (metadata.size > MAX_COMMENT_IMAGE_BYTES) {
          throw new ConvexError('Image must be under 5MB');
        }

        return {
          pendingId: pending._id,
          storageId: attachment.storageId,
          fileName: attachment.fileName,
          contentType: metadata.contentType,
          size: metadata.size,
        };
      }),
    );

    const commentId = await ctx.db.insert('comments', {
      planId: args.planId,
      authorId: user._id,
      authorName: user.name ?? 'Anonymous',
      authorAvatar: user.image ?? undefined,
      body: trimmedBody,
      ...(validatedAttachments.length > 0
        ? {
            attachments: validatedAttachments.map(({ pendingId: _, ...rest }) => rest),
          }
        : {}),
      createdAt: Date.now(),
    });

    for (const { pendingId } of validatedAttachments) {
      await ctx.db.delete(pendingId);
    }

    return commentId;
  },
});

export const deleteOrphanedUpload = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const pending = await ctx.db
      .query('pendingUploads')
      .withIndex('by_user_storage', (q) =>
        q.eq('uploadedBy', user._id).eq('storageId', args.storageId),
      )
      .first();

    if (!pending) {
      throw new ConvexError('Upload not found or not owned by user');
    }

    await ctx.db.delete(pending._id);
    await ctx.storage.delete(args.storageId);
  },
});

export const deleteUntrackedUpload = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) return;

    const MAX_UNTRACKED_AGE_MS = 60 * 1000;
    if (Date.now() - metadata._creationTime > MAX_UNTRACKED_AGE_MS) {
      throw new ConvexError('File too old for untracked deletion');
    }

    await ctx.storage.delete(args.storageId);
  },
});

export const editComment = mutation({
  args: {
    commentId: v.id('comments'),
    body: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new ConvexError('Comment not found');
    }

    if (comment.authorId !== user._id) {
      throw new ConvexError('Only the comment author can edit');
    }

    const plan = await ctx.db.get(comment.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else {
      if (!args.token) throw new ConvexError('Share token required');
      await validateShareToken(ctx, comment.planId, args.token);
    }

    const trimmed = args.body.trim();
    const hasAttachments = (comment.attachments ?? []).length > 0;
    if (!trimmed && !hasAttachments) throw new ConvexError('Comment body cannot be empty');
    if (trimmed === comment.body) return;

    await ctx.db.patch(args.commentId, {
      body: trimmed,
      updatedAt: Date.now(),
    });
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id('comments'), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new ConvexError('Comment not found');
    }

    const plan = await ctx.db.get(comment.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    // Plan owners can delete any comment without a share token.
    // Non-owners (including comment authors) must provide a valid share token.
    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else if (comment.authorId !== user._id) {
      throw new ConvexError('Access denied');
    }

    if (!isOwner) {
      if (!args.token) throw new ConvexError('Share token required');
      await validateShareToken(ctx, comment.planId, args.token);
    }

    for (const attachment of comment.attachments ?? []) {
      try {
        await ctx.storage.delete(attachment.storageId);
      } catch {
        // File may already be deleted; continue cleanup
      }
    }

    await ctx.db.delete(args.commentId);
  },
});

const STALE_UPLOAD_AGE_MS = 15 * 60 * 1000;

export const cleanupStalePendingUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_UPLOAD_AGE_MS;
    let deleted = 0;

    // Pass 1: clean up stale pendingUploads records + their storage files
    const stale = await ctx.db
      .query('pendingUploads')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500);

    for (const record of stale) {
      try {
        await ctx.storage.delete(record.storageId);
      } catch {
        // File may already be deleted; continue cleanup
      }
      await ctx.db.delete(record._id);
      deleted++;
    }

    // Pass 2: clean up untracked storage files (uploaded but never tracked,
    // e.g. client crashed between fetch and trackPendingUpload)
    const referencedIds = new Set<string>();

    const allPending = await ctx.db.query('pendingUploads').collect();
    for (const p of allPending) referencedIds.add(p.storageId);

    const allComments = await ctx.db.query('comments').collect();
    for (const c of allComments) {
      for (const a of c.attachments ?? []) referencedIds.add(a.storageId);
    }

    const storageFiles = await ctx.db.system.query('_storage').order('asc').take(500);
    for (const file of storageFiles) {
      if (file._creationTime > cutoff) continue;
      if (!file.contentType || !ALLOWED_COMMENT_IMAGE_TYPES.has(file.contentType)) continue;
      if (referencedIds.has(file._id)) continue;
      try {
        await ctx.storage.delete(file._id);
        deleted++;
      } catch {
        // already deleted
      }
    }

    return { deleted };
  },
});
