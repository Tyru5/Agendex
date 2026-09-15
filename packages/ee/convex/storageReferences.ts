import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

type StorageReferenceCtx = Pick<QueryCtx, 'db'>;

export interface StorageReferences {
  commentAttachment: boolean;
  pendingCommentUpload: boolean;
  dataExport: boolean;
  agentAvatar: boolean;
}

export async function inspectStorageReferences(
  ctx: StorageReferenceCtx,
  storageId: Id<'_storage'>,
  options?: { excludeAvatarId?: Id<'agentAvatars'> },
): Promise<StorageReferences> {
  const [commentAttachment, pendingCommentUpload, dataExport, avatars] = await Promise.all([
    ctx.db
      .query('commentAttachmentClaims')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first(),
    ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first(),
    ctx.db
      .query('dataExports')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first(),
    ctx.db
      .query('agentAvatars')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .take(options?.excludeAvatarId ? 2 : 1),
  ]);

  return {
    commentAttachment: commentAttachment !== null,
    pendingCommentUpload: pendingCommentUpload !== null,
    dataExport: dataExport !== null,
    agentAvatar: avatars.some((avatar) => avatar._id !== options?.excludeAvatarId),
  };
}

export function hasAnyStorageReference(references: StorageReferences): boolean {
  return (
    references.commentAttachment ||
    references.pendingCommentUpload ||
    references.dataExport ||
    references.agentAvatar
  );
}
