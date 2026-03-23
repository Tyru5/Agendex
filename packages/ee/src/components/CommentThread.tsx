import { SkeletonBlock } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

type PendingImage = {
  file: File;
  previewUrl: string;
};

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function CommentThread({
  planId,
  isOwner,
  shareToken,
}: {
  planId: string;
  isOwner?: boolean;
  shareToken?: string;
}) {
  const { user, isAuthenticated, signIn } = useAuth();
  const comments = useQuery(api.comments.getComments, {
    planId: planId as Id<'plans'>,
    ...(shareToken ? { token: shareToken } : {}),
  });
  const addComment = useMutation(api.comments.addComment);
  const editComment = useMutation(api.comments.editComment);
  const deleteComment = useMutation(api.comments.deleteComment);
  const generateUploadUrl = useMutation(api.comments.generateCommentImageUploadUrl);
  const trackPendingUpload = useMutation(api.comments.trackPendingUpload);
  const deleteOrphanedUpload = useMutation(api.comments.deleteOrphanedUpload);
  const deleteUntrackedUpload = useMutation(api.comments.deleteUntrackedUpload);

  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImagesRef = useRef(pendingImages);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => {
    return () => {
      for (const img of pendingImagesRef.current) {
        URL.revokeObjectURL(img.previewUrl);
      }
    };
  }, []);

  function handleFilesSelected(files: FileList | null) {
    if (!files) return;
    setError(null);

    const newFiles = Array.from(files);
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of newFiles) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        errors.push(`"${file.name}" is not a supported type.`);
      } else if (file.size > MAX_IMAGE_BYTES) {
        errors.push(`"${file.name}" exceeds 5MB.`);
      } else {
        validFiles.push(file);
      }
    }

    const available = MAX_IMAGE_COUNT - pendingImages.length;
    if (validFiles.length > available) {
      validFiles.splice(available);
      errors.push(`Maximum ${MAX_IMAGE_COUNT} images per comment.`);
    }

    if (errors.length > 0) setError(errors.join(' '));
    if (validFiles.length === 0) return;

    const newPending = validFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...newPending]);
  }

  function removeImage(index: number) {
    setPendingImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  const handlePost = useCallback(async () => {
    const trimmed = body.trim();
    if (posting || (!trimmed && pendingImages.length === 0)) return;
    setPosting(true);
    setError(null);

    try {
      type UploadResult = {
        storageId?: Id<'_storage'>;
        fileName: string;
        tracked: boolean;
        error?: string;
      };

      const results = await Promise.allSettled(
        pendingImages.map(async (pending): Promise<UploadResult> => {
          const uploadUrl = await generateUploadUrl({
            planId: planId as Id<'plans'>,
            ...(shareToken ? { token: shareToken } : {}),
          });

          const result = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': pending.file.type },
            body: pending.file,
          });

          if (!result.ok) {
            return {
              fileName: pending.file.name,
              tracked: false,
              error: `Failed to upload "${pending.file.name}"`,
            };
          }

          const { storageId } = (await result.json()) as { storageId: Id<'_storage'> };

          try {
            const trackResult = await trackPendingUpload({
              storageId,
              planId: planId as Id<'plans'>,
              ...(shareToken ? { token: shareToken } : {}),
            });

            if (trackResult && !trackResult.success) {
              return {
                storageId,
                fileName: pending.file.name,
                tracked: false,
                error: trackResult.error,
              };
            }
          } catch {
            return {
              storageId,
              fileName: pending.file.name,
              tracked: false,
              error: `Failed to track "${pending.file.name}"`,
            };
          }

          return { storageId, fileName: pending.file.name, tracked: true };
        }),
      );

      const settled = results.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : ({
              fileName: '?',
              tracked: false,
              error: r.reason?.message ?? 'Upload failed',
            } as UploadResult),
      );
      const succeeded = settled.filter(
        (r): r is UploadResult & { storageId: Id<'_storage'>; tracked: true } =>
          r.tracked && !!r.storageId,
      );
      const failed = settled.filter((r) => !r.tracked || r.error);

      if (failed.length > 0) {
        const allStorageIds = settled.filter(
          (r): r is UploadResult & { storageId: Id<'_storage'> } => !!r.storageId,
        );
        await Promise.allSettled(
          allStorageIds.map((a) =>
            a.tracked
              ? deleteOrphanedUpload({ storageId: a.storageId })
              : deleteUntrackedUpload({ storageId: a.storageId }),
          ),
        );
        throw new Error(failed.map((r) => r.error ?? 'Upload failed').join(', '));
      }

      try {
        await addComment({
          planId: planId as Id<'plans'>,
          body: trimmed,
          ...(succeeded.length > 0
            ? { attachments: succeeded.map(({ storageId, fileName }) => ({ storageId, fileName })) }
            : {}),
          ...(shareToken ? { token: shareToken } : {}),
        });
      } catch (addErr) {
        await Promise.allSettled(
          succeeded.map((a) => deleteOrphanedUpload({ storageId: a.storageId })),
        );
        throw addErr;
      }

      setBody('');
      for (const img of pendingImages) {
        URL.revokeObjectURL(img.previewUrl);
      }
      setPendingImages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  }, [
    body,
    posting,
    pendingImages,
    generateUploadUrl,
    trackPendingUpload,
    planId,
    shareToken,
    addComment,
    deleteOrphanedUpload,
    deleteUntrackedUpload,
  ]);

  async function handleSaveEdit(commentId: string, originalBody: string, hasAttachments: boolean) {
    const trimmed = editBody.trim();
    if ((!trimmed && !hasAttachments) || trimmed === originalBody) return;
    setSaving(true);
    try {
      await editComment({
        commentId: commentId as Id<'comments'>,
        body: trimmed,
        ...(shareToken ? { token: shareToken } : {}),
      });
      let wasEditing = false;
      setEditingId((prev) => {
        if (prev === commentId) {
          wasEditing = true;
          return null;
        }
        return prev;
      });
      if (wasEditing) setEditBody('');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(commentId: string) {
    setDeletingId(commentId);
    try {
      await deleteComment({
        commentId: commentId as Id<'comments'>,
        ...(shareToken ? { token: shareToken } : {}),
      });
    } finally {
      setDeletingId(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePost();
    }
  }

  const canPost = !posting && (body.trim().length > 0 || pendingImages.length > 0);

  function handleEditKeyDown(e: React.KeyboardEvent, commentId: string, originalBody: string) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!saving) handleSaveEdit(commentId, originalBody);
    }
    if (e.key === 'Escape') {
      if (saving) return;
      e.preventDefault();
      setEditingId(null);
      setEditBody('');
    }
  }

  return (
    <div className="mt-10">
      <h3 className="text-[13px] font-semibold text-text tracking-[-0.01em] mb-4">
        Comments
        {comments && comments.length > 0 && (
          <span className="ml-1.5 text-[11.5px] font-[450] text-tertiary">({comments.length})</span>
        )}
      </h3>

      {/* Comment input */}
      {isAuthenticated ? (
        <div className="mb-5">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment…"
            rows={3}
            className="w-full py-2.5 px-3 text-[13px] font-[inherit] leading-[1.5] text-text bg-transparent border border-border rounded-lg resize-y outline-none box-border"
          />

          {/* Image previews */}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {pendingImages.map((img, i) => (
                <div key={img.previewUrl} className="relative group">
                  <img
                    src={img.previewUrl}
                    alt={img.file.name}
                    className="w-16 h-16 object-cover rounded-md border border-border"
                  />
                  {!posting && (
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full bg-text text-bg text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border-none cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-[12px] text-red-500 mt-1.5">{error}</p>}

          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-tertiary">⌘+Enter to post</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={posting || pendingImages.length >= MAX_IMAGE_COUNT}
                className="py-0.5 px-2 text-[11px] font-[450] font-[inherit] rounded-[5px] border border-border bg-transparent text-secondary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFilesSelected(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            <button
              type="button"
              onClick={handlePost}
              disabled={!canPost}
              className="py-[5px] px-3.5 text-[12.5px] font-[550] font-[inherit] rounded-[7px] border-none bg-text text-bg"
              style={{
                cursor: canPost ? 'pointer' : 'not-allowed',
                opacity: canPost ? 1 : 0.5,
              }}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 py-3 px-3.5 rounded-lg border border-border mb-5">
          <span className="text-[12.5px] text-tertiary">Sign in to comment</span>
          <button
            type="button"
            onClick={() => signIn.social({ provider: 'github', callbackURL: window.location.href })}
            className="py-1 px-3 text-[12px] font-medium font-[inherit] rounded-[6px] border border-border bg-transparent text-secondary cursor-pointer"
          >
            Sign in
          </button>
        </div>
      )}

      {/* Comments list */}
      {comments === undefined ? (
        <SkeletonBlock lines={2} />
      ) : comments.length === 0 ? (
        <div className="text-[12.5px] text-tertiary">No comments yet.</div>
      ) : (
        <div>
          {comments.map(
            (comment: {
              _id: string;
              authorId: string;
              authorName: string;
              authorAvatar?: string;
              body: string;
              attachments?: Array<{
                storageId: string;
                fileName?: string;
                contentType: string;
                size: number;
                url: string;
              }>;
              createdAt: number;
              updatedAt?: number;
            }) => {
              const isEditing = editingId === comment._id;
              const isDeleting = deletingId === comment._id;
              const isAuthor = user?.id === comment.authorId;

              return (
                <div key={comment._id} className="py-3 border-t border-border">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {comment.authorAvatar ? (
                        <img
                          src={comment.authorAvatar}
                          alt=""
                          className="w-5 h-5 rounded-full shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-hover flex items-center justify-center text-[10px] font-semibold text-secondary shrink-0">
                          {comment.authorName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-[12.5px] font-[550] text-text">
                        {comment.authorName}
                      </span>
                      <span className="text-[11.5px] text-tertiary">
                        {timeAgo(comment.createdAt)}
                      </span>
                      {comment.updatedAt && (
                        <span className="text-[11px] text-tertiary italic">(edited)</span>
                      )}
                    </div>
                    {!isEditing && (isOwner || isAuthor) && (
                      <div className="flex items-center gap-1">
                        {isAuthor && typeof comment.body === 'string' && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              setEditingId(comment._id);
                              setEditBody(comment.body);
                            }}
                            className="py-0.5 px-2 text-[11px] font-[450] font-[inherit] rounded-[5px] border-none bg-transparent text-tertiary"
                            style={{
                              cursor: saving ? 'not-allowed' : 'pointer',
                              opacity: saving ? 0.5 : 1,
                            }}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(comment._id)}
                          disabled={isDeleting}
                          className="py-0.5 px-2 text-[11px] font-[450] font-[inherit] rounded-[5px] border-none bg-transparent text-tertiary"
                          style={{
                            cursor: isDeleting ? 'not-allowed' : 'pointer',
                            opacity: isDeleting ? 0.5 : 1,
                          }}
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="mt-1.5 ml-7">
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, comment._id, comment.body)}
                        disabled={saving}
                        rows={3}
                        className="w-full py-2.5 px-3 text-[13px] font-[inherit] leading-[1.5] text-text bg-transparent border border-border rounded-lg resize-y outline-none box-border"
                        style={{ opacity: saving ? 0.6 : 1 }}
                      />
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px] text-tertiary">
                          ⌘+Enter to save · Esc to cancel
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditBody('');
                            }}
                            disabled={saving}
                            className="py-[5px] px-3.5 text-[12.5px] font-[550] font-[inherit] rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
                            style={{ opacity: saving ? 0.5 : 1 }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleSaveEdit(
                                comment._id,
                                comment.body,
                                (comment.attachments?.length ?? 0) > 0,
                              )
                            }
                            disabled={
                              saving ||
                              (!editBody.trim() &&
                                !(comment.attachments && comment.attachments.length > 0)) ||
                              editBody.trim() === comment.body
                            }
                            className="py-[5px] px-3.5 text-[12.5px] font-[550] font-[inherit] rounded-[7px] border-none bg-text text-bg"
                            style={{
                              cursor:
                                saving ||
                                (!editBody.trim() &&
                                  !(comment.attachments && comment.attachments.length > 0)) ||
                                editBody.trim() === comment.body
                                  ? 'not-allowed'
                                  : 'pointer',
                              opacity:
                                saving ||
                                (!editBody.trim() &&
                                  !(comment.attachments && comment.attachments.length > 0)) ||
                                editBody.trim() === comment.body
                                  ? 0.5
                                  : 1,
                            }}
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {comment.body && (
                        <p className="mt-1.5 ml-7 text-[13.5px] leading-[1.55] text-text whitespace-pre-wrap break-words">
                          {comment.body}
                        </p>
                      )}
                      {comment.attachments && comment.attachments.length > 0 && (
                        <div className="mt-2 ml-7 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {comment.attachments.map((attachment) => (
                            <a
                              key={attachment.storageId}
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block"
                            >
                              <img
                                src={attachment.url}
                                alt={attachment.fileName ?? 'Image'}
                                loading="lazy"
                                className="w-full rounded-md border border-border object-cover max-h-60"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}
