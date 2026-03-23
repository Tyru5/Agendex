import { SkeletonBlock } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';

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

  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handlePost() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      await addComment({
        planId: planId as Id<'plans'>,
        body: trimmed,
        ...(shareToken ? { token: shareToken } : {}),
      });
      setBody('');
    } finally {
      setPosting(false);
    }
  }

  async function handleSaveEdit(commentId: string, originalBody: string) {
    const trimmed = editBody.trim();
    if (!trimmed || trimmed === originalBody) return;
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
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-tertiary">⌘+Enter to post</span>
            <button
              type="button"
              onClick={handlePost}
              disabled={posting || !body.trim()}
              className="py-[5px] px-3.5 text-[12.5px] font-[550] font-[inherit] rounded-[7px] border-none bg-text text-bg"
              style={{
                cursor: posting || !body.trim() ? 'not-allowed' : 'pointer',
                opacity: posting || !body.trim() ? 0.5 : 1,
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
                        {isAuthor && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              setEditingId(comment._id);
                              setEditBody(comment.body);
                            }}
                            className="py-0.5 px-2 text-[11px] font-[450] font-[inherit] rounded-[5px] border-none bg-transparent text-tertiary"
                            style={{ cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}
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
                            onClick={() => handleSaveEdit(comment._id, comment.body)}
                            disabled={saving || !editBody.trim() || editBody.trim() === comment.body}
                            className="py-[5px] px-3.5 text-[12.5px] font-[550] font-[inherit] rounded-[7px] border-none bg-text text-bg"
                            style={{
                              cursor: saving || !editBody.trim() || editBody.trim() === comment.body ? 'not-allowed' : 'pointer',
                              opacity: saving || !editBody.trim() || editBody.trim() === comment.body ? 0.5 : 1,
                            }}
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 ml-7 text-[13.5px] leading-[1.55] text-text whitespace-pre-wrap break-words">
                      {comment.body}
                    </p>
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
