import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Plan } from '../lib/api.ts';
import { usePublishing } from '../hooks/usePublishing.ts';

const appUrl = (import.meta.env.VITE_APP_URL as string) || window.location.origin;

export function SharePlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { publish } = usePublishing();
  const createShareLink = useMutation(api.sharing.createShareLink);
  const revokeShareLink = useMutation(api.sharing.revokeShareLink);

  const [publishedPlanId, setPublishedPlanId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const shareLinks = useQuery(
    api.sharing.getShareLinks,
    publishedPlanId ? { planId: publishedPlanId } : 'skip',
  );

  async function handlePublishAndShare() {
    setPublishing(true);
    try {
      const result = await publish(plan);
      const planId =
        (result as { _id?: string; planId?: string })?._id ??
        (result as { planId?: string })?.planId ??
        (result as string);
      setPublishedPlanId(planId as string);
      await createShareLink({ planId: planId as string });
    } finally {
      setPublishing(false);
    }
  }

  async function handleCopy(token: string) {
    const url = `${appUrl}/shared/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  async function handleRevoke(linkId: string) {
    await revokeShareLink({ shareLinkId: linkId });
  }

  const hasLinks = shareLinks && shareLinks.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '440px',
          margin: '0 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '28px 32px',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            border: 'none',
            background: 'transparent',
            color: 'var(--tertiary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            fontFamily: 'inherit',
          }}
        >
          ×
        </button>

        <h2
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.02em',
            marginBottom: '6px',
          }}
        >
          Share Plan
        </h2>
        <p
          style={{
            fontSize: '12.5px',
            color: 'var(--tertiary)',
            marginBottom: '20px',
            lineHeight: 1.5,
          }}
        >
          Create an unlisted link anyone can use to view this plan.
        </p>

        {/* Share links list */}
        {hasLinks && (
          <div style={{ marginBottom: '16px' }}>
            {shareLinks.map((link: { _id: string; token: string }) => {
              const url = `${appUrl}/shared/${link.token}`;
              return (
                <div
                  key={link._id}
                  className="flex items-center gap-2"
                  style={{
                    padding: '8px 10px',
                    borderRadius: '7px',
                    border: '1px solid var(--border)',
                    marginBottom: '8px',
                    background: 'var(--bg)',
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: '12px',
                      color: 'var(--secondary)',
                      fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {url}
                  </span>
                  <button
                    onClick={() => handleCopy(link.token)}
                    style={{
                      padding: '3px 10px',
                      fontSize: '11.5px',
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: copiedToken === link.token ? '#16a34a' : 'var(--secondary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {copiedToken === link.token ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => handleRevoke(link._id)}
                    style={{
                      padding: '3px 10px',
                      fontSize: '11.5px',
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: '#ef4444',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Publish & Share button */}
        <button
          onClick={handlePublishAndShare}
          disabled={publishing}
          style={{
            width: '100%',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 550,
            fontFamily: 'inherit',
            borderRadius: '8px',
            border: 'none',
            background: 'var(--text)',
            color: 'var(--bg)',
            cursor: publishing ? 'not-allowed' : 'pointer',
            opacity: publishing ? 0.6 : 1,
          }}
        >
          {publishing ? 'Publishing…' : hasLinks ? 'Create Another Link' : 'Publish & Share'}
        </button>
      </div>
    </div>
  );
}
