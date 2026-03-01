import { SkeletonBlock } from '@agendex/web';
import { api } from '@convex/_generated/api';
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
    planId,
    ...(shareToken ? { token: shareToken } : {}),
  });
  const addComment = useMutation(api.comments.addComment);
  const deleteComment = useMutation(api.comments.deleteComment);

  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  async function handlePost() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      await addComment({ planId, body: trimmed, ...(shareToken ? { token: shareToken } : {}) });
      setBody('');
    } finally {
      setPosting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePost();
    }
  }

  return (
    <div style={{ marginTop: '40px' }}>
      <h3
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--text)',
          letterSpacing: '-0.01em',
          marginBottom: '16px',
        }}
      >
        Comments
        {comments && comments.length > 0 && (
          <span
            style={{
              marginLeft: '6px',
              fontSize: '11.5px',
              fontWeight: 450,
              color: 'var(--tertiary)',
            }}
          >
            ({comments.length})
          </span>
        )}
      </h3>

      {/* Comment input */}
      {isAuthenticated ? (
        <div style={{ marginBottom: '20px' }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment…"
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: '13px',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              color: 'var(--text)',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div className="flex items-center justify-between" style={{ marginTop: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--tertiary)' }}>⌘+Enter to post</span>
            <button
              type="button"
              onClick={handlePost}
              disabled={posting || !body.trim()}
              style={{
                padding: '5px 14px',
                fontSize: '12.5px',
                fontWeight: 550,
                fontFamily: 'inherit',
                borderRadius: '7px',
                border: 'none',
                background: 'var(--text)',
                color: 'var(--bg)',
                cursor: posting || !body.trim() ? 'not-allowed' : 'pointer',
                opacity: posting || !body.trim() ? 0.5 : 1,
              }}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-3"
          style={{
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            marginBottom: '20px',
          }}
        >
          <span style={{ fontSize: '12.5px', color: 'var(--tertiary)' }}>Sign in to comment</span>
          <button
            type="button"
            onClick={() => signIn.social({ provider: 'github', callbackURL: '/' })}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--secondary)',
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </div>
      )}

      {/* Comments list */}
      {comments === undefined ? (
        <SkeletonBlock lines={2} />
      ) : comments.length === 0 ? (
        <div style={{ fontSize: '12.5px', color: 'var(--tertiary)' }}>No comments yet.</div>
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
            }) => (
              <div
                key={comment._id}
                style={{
                  padding: '12px 0',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                    {comment.authorAvatar ? (
                      <img
                        src={comment.authorAvatar}
                        alt=""
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '999px',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '999px',
                          background: 'var(--hover)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'var(--secondary)',
                          flexShrink: 0,
                        }}
                      >
                        {comment.authorName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 550,
                        color: 'var(--text)',
                      }}
                    >
                      {comment.authorName}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--tertiary)' }}>
                      {timeAgo(comment.createdAt)}
                    </span>
                  </div>
                  {(isOwner || user?.id === comment.authorId) && (
                    <button
                      type="button"
                      onClick={() => deleteComment({ commentId: comment._id })}
                      style={{
                        padding: '2px 8px',
                        fontSize: '11px',
                        fontWeight: 450,
                        fontFamily: 'inherit',
                        borderRadius: '5px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--tertiary)',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p
                  style={{
                    marginTop: '6px',
                    marginLeft: '28px',
                    fontSize: '13.5px',
                    lineHeight: 1.55,
                    color: 'var(--text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {comment.body}
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
