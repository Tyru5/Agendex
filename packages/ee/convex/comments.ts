import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, type QueryCtx, query } from './_generated/server';
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
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    await ctx.db.insert('pendingUploads', {
      storageId: args.storageId,
      uploadedBy: user._id,
      planId: args.planId,
      createdAt: Date.now(),
    });
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
      ...(validatedAttachments.length > 0 ? { attachments: validatedAttachments } : {}),
      createdAt: Date.now(),
    });

    for (const attachment of validatedAttachments) {
      const pending = await ctx.db
        .query('pendingUploads')
        .withIndex('by_storage', (q) => q.eq('storageId', attachment.storageId))
        .first();
      if (pending) await ctx.db.delete(pending._id);
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

export const deleteComment = mutation({
  args: { commentId: v.id('comments') },
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

    const isOwner = plan.ownerId === user._id;
    if (isOwner) {
      await requireFeature(ctx, ProFeature.COMMENTS);
    } else if (comment.authorId !== user._id) {
      throw new ConvexError('Access denied');
    }

    for (const attachment of comment.attachments ?? []) {
      await ctx.storage.delete(attachment.storageId);
    }

    await ctx.db.delete(args.commentId);
  },
});
