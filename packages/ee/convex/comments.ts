import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from './_generated/server';
import { isAgentAvatarStorageId } from './agentAvatars';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';

const MAX_COMMENT_IMAGE_COUNT = 4;
const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_COMMENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_TRACKED_UPLOAD_AGE_MS = 5 * 60 * 1000;
const STALE_COMMENT_UPLOAD_AGE_MS = 15 * 60 * 1000;
const commentDtoValidator = v.object({
  _id: v.id('comments'),
  _creationTime: v.number(),
  planId: v.id('plans'),
  authorId: v.string(),
  authorName: v.string(),
  authorAvatar: v.optional(v.string()),
  body: v.string(),
  attachments: v.array(
    v.object({
      storageId: v.id('_storage'),
      fileName: v.optional(v.string()),
      contentType: v.string(),
      size: v.number(),
      url: v.string(),
    }),
  ),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
});

type CommentStorageCtx = Pick<MutationCtx, 'db' | 'storage'>;

async function validateShareToken(ctx: QueryCtx, planId: string, token: string): Promise<void> {
  const shareLink = await ctx.db
    .query('shareLinks')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();

  if (!shareLink || shareLink.planId !== planId) {
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

async function isCommentReferencedStorageId(
  ctx: Pick<QueryCtx, 'db'>,
  storageId: Id<'_storage'>,
): Promise<boolean> {
  const claim = await ctx.db
    .query('commentAttachmentClaims')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .first();
  return claim !== null;
}

async function isPendingUploadStorageId(
  ctx: Pick<QueryCtx, 'db'>,
  storageId: Id<'_storage'>,
): Promise<boolean> {
  const pendingUpload = await ctx.db
    .query('pendingUploads')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .first();
  return pendingUpload !== null;
}

async function createCommentAttachmentClaims(
  ctx: Pick<MutationCtx, 'db'>,
  commentId: Id<'comments'>,
  attachments: Array<{ storageId: Id<'_storage'> }>,
): Promise<void> {
  for (const attachment of attachments) {
    await ctx.db.insert('commentAttachmentClaims', {
      storageId: attachment.storageId,
      commentId,
    });
  }
}

async function deleteCommentAttachmentClaims(
  ctx: Pick<MutationCtx, 'db'>,
  commentId: Id<'comments'>,
): Promise<void> {
  const claims = await ctx.db
    .query('commentAttachmentClaims')
    .withIndex('by_comment', (q) => q.eq('commentId', commentId))
    .collect();

  for (const claim of claims) {
    await ctx.db.delete(claim._id);
  }
}

async function findUploadReservation(
  ctx: Pick<MutationCtx, 'db'>,
  {
    uploadedBy,
    planId,
    clientUploadId,
  }: {
    uploadedBy: string;
    planId: Id<'plans'>;
    clientUploadId?: string;
  },
) {
  if (clientUploadId) {
    return await ctx.db
      .query('commentUploadReservations')
      .withIndex('by_user_plan_clientUploadId', (q) =>
        q.eq('uploadedBy', uploadedBy).eq('planId', planId).eq('clientUploadId', clientUploadId),
      )
      .first();
  }

  return await ctx.db
    .query('commentUploadReservations')
    .withIndex('by_user_plan_createdAt', (q) => q.eq('uploadedBy', uploadedBy).eq('planId', planId))
    .order('asc')
    .first();
}

async function reserveCommentUpload(
  ctx: Pick<MutationCtx, 'db'>,
  {
    uploadedBy,
    planId,
    clientUploadId,
  }: {
    uploadedBy: string;
    planId: Id<'plans'>;
    clientUploadId?: string;
  },
): Promise<void> {
  if (clientUploadId) {
    const existingReservation = await findUploadReservation(ctx, {
      uploadedBy,
      planId,
      clientUploadId,
    });

    if (existingReservation) {
      return;
    }
  }

  await ctx.db.insert('commentUploadReservations', {
    ...(clientUploadId ? { clientUploadId } : {}),
    uploadedBy,
    planId,
    createdAt: Date.now(),
  });
}

async function deleteStorageFile(
  ctx: Pick<MutationCtx, 'storage'>,
  storageId: Id<'_storage'>,
): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // File may already be deleted; continue cleanup
  }
}

export async function deletePendingUploadRecord(
  ctx: CommentStorageCtx,
  pendingUpload: Pick<Doc<'pendingUploads'>, '_id' | 'storageId'>,
  options?: { deleteStorage?: boolean },
): Promise<void> {
  if (options?.deleteStorage ?? true) {
    await deleteStorageFile(ctx, pendingUpload.storageId);
  }

  await ctx.db.delete(pendingUpload._id);
}

export async function deleteCommentWithAttachments(
  ctx: CommentStorageCtx,
  comment: Pick<Doc<'comments'>, '_id' | 'attachments'>,
): Promise<void> {
  for (const attachment of comment.attachments ?? []) {
    await deleteStorageFile(ctx, attachment.storageId);
  }

  await deleteCommentAttachmentClaims(ctx, comment._id);
  await ctx.db.delete(comment._id);
}

export const getComments = query({
  args: { planId: v.id('plans'), token: v.optional(v.string()) },
  returns: v.array(commentDtoValidator),
  handler: async (ctx, args) => {
    await validateCommentAccess(ctx, args.planId, args.token);

    const comments = await ctx.db
      .query('comments')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('asc')
      .collect();

    return await Promise.all(
      comments.map(async (comment) => ({
        _id: comment._id,
        _creationTime: comment._creationTime,
        planId: comment.planId,
        authorId: comment.authorId,
        authorName: comment.authorName,
        ...(comment.authorAvatar !== undefined && { authorAvatar: comment.authorAvatar }),
        body: comment.body,
        attachments: (
          await Promise.all(
            (comment.attachments ?? []).map(async (attachment) => {
              const url = await ctx.storage.getUrl(attachment.storageId);
              if (!url) return null;
              return {
                storageId: attachment.storageId,
                ...(attachment.fileName !== undefined && { fileName: attachment.fileName }),
                contentType: attachment.contentType,
                size: attachment.size,
                url,
              };
            }),
          )
        ).filter((attachment) => attachment !== null),
        createdAt: comment.createdAt,
        ...(comment.updatedAt !== undefined && { updatedAt: comment.updatedAt }),
      })),
    );
  },
});

export const generateCommentImageUploadUrl = mutation({
  args: {
    planId: v.id('plans'),
    token: v.optional(v.string()),
    clientUploadId: v.optional(v.string()),
  },
  returns: v.string(),
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

    await reserveCommentUpload(ctx, {
      uploadedBy: user._id,
      planId: args.planId,
      ...(args.clientUploadId ? { clientUploadId: args.clientUploadId } : {}),
    });

    return await ctx.storage.generateUploadUrl();
  },
});

export const trackPendingUpload = mutation({
  args: {
    storageId: v.id('_storage'),
    planId: v.id('plans'),
    token: v.optional(v.string()),
    clientUploadId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
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

    const reservation = await findUploadReservation(ctx, {
      uploadedBy: user._id,
      planId: args.planId,
      ...(args.clientUploadId ? { clientUploadId: args.clientUploadId } : {}),
    });
    if (!reservation) {
      throw new ConvexError('Upload reservation not found or expired');
    }

    const existingClaim = await ctx.db
      .query('commentAttachmentClaims')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .first();
    if (existingClaim) {
      throw new ConvexError('Storage ID already attached to a comment');
    }

    const existing = await ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .first();
    if (existing) {
      throw new ConvexError('Storage ID already claimed');
    }

    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) {
      await ctx.db.delete(reservation._id);
      throw new ConvexError('File not found');
    }
    if (Date.now() - metadata._creationTime > MAX_TRACKED_UPLOAD_AGE_MS) {
      await deleteStorageFile(ctx, args.storageId);
      await ctx.db.delete(reservation._id);
      throw new ConvexError('Upload expired');
    }

    if (!metadata.contentType || !ALLOWED_COMMENT_IMAGE_TYPES.has(metadata.contentType)) {
      await deleteStorageFile(ctx, args.storageId);
      await ctx.db.delete(reservation._id);
      return {
        success: false as const,
        error: `File type "${metadata.contentType ?? 'unknown'}" is not allowed. Use JPEG, PNG, WebP, or GIF.`,
      };
    }
    if (metadata.size > MAX_COMMENT_IMAGE_BYTES) {
      await deleteStorageFile(ctx, args.storageId);
      await ctx.db.delete(reservation._id);
      return { success: false as const, error: 'Image must be under 5MB' };
    }

    await ctx.db.insert('pendingUploads', {
      storageId: args.storageId,
      uploadedBy: user._id,
      planId: args.planId,
      createdAt: Date.now(),
    });
    await ctx.db.delete(reservation._id);
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
  returns: v.id('comments'),
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
        if (pending.planId !== args.planId) {
          throw new ConvexError('Upload does not belong to this plan');
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

    await createCommentAttachmentClaims(ctx, commentId, validatedAttachments);

    for (const { pendingId } of validatedAttachments) {
      await ctx.db.delete(pendingId);
    }

    return commentId;
  },
});

export const deleteOrphanedUpload = mutation({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
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

    await deletePendingUploadRecord(ctx, pending);
    return null;
  },
});

export const editComment = mutation({
  args: {
    commentId: v.id('comments'),
    body: v.string(),
    token: v.optional(v.string()),
  },
  returns: v.null(),
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
    if (trimmed === comment.body) return null;

    await ctx.db.patch(args.commentId, {
      body: trimmed,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id('comments'), token: v.optional(v.string()) },
  returns: v.null(),
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

    await deleteCommentWithAttachments(ctx, comment);
    return null;
  },
});

export const cleanupStalePendingUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_COMMENT_UPLOAD_AGE_MS;
    let deletedReservations = 0;
    let deletedPendingUploads = 0;
    let deletedUntrackedFiles = 0;

    const staleReservations = await ctx.db
      .query('commentUploadReservations')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500);

    for (const reservation of staleReservations) {
      await ctx.db.delete(reservation._id);
      deletedReservations++;
    }

    // Pass 1: clean up stale tracked uploads and their storage files.
    const stale = await ctx.db
      .query('pendingUploads')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500);

    for (const record of stale) {
      if (
        !(await isCommentReferencedStorageId(ctx, record.storageId)) &&
        !(await isAgentAvatarStorageId(ctx, record.storageId))
      ) {
        await deleteStorageFile(ctx, record.storageId);
      }
      await ctx.db.delete(record._id);
      deletedPendingUploads++;
    }

    // Pass 2: delete stale untracked blobs that are not referenced anywhere.
    const staleStorageObjects = await ctx.db.system
      .query('_storage')
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', cutoff))
      .take(500);

    for (const storageObject of staleStorageObjects) {
      if (await isCommentReferencedStorageId(ctx, storageObject._id)) continue;
      if (await isPendingUploadStorageId(ctx, storageObject._id)) continue;
      if (await isAgentAvatarStorageId(ctx, storageObject._id)) continue;

      await deleteStorageFile(ctx, storageObject._id);
      deletedUntrackedFiles++;
    }

    return { deletedReservations, deletedPendingUploads, deletedUntrackedFiles };
  },
});
