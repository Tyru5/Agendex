import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { type Plan } from '@agendex/web';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
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
    publishedPlanId ? { planId: publishedPlanId as Id<'plans'> } : 'skip',
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
      await createShareLink({ planId: planId as Id<'plans'> });
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
    await revokeShareLink({ shareLinkId: linkId as Id<'shareLinks'> });
  }

  const hasLinks = shareLinks && shareLinks.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[4px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="relative w-full max-w-[440px] mx-4 bg-surface border border-border rounded-default py-7 px-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 w-7 h-7 rounded-[6px] border-none bg-transparent text-tertiary cursor-pointer flex items-center justify-center text-[18px] font-[inherit]"
        >
          ×
        </button>

        <h2 className="text-[15px] font-semibold text-text tracking-[-0.02em] mb-1.5">
          Share Plan
        </h2>
        <p className="text-[12.5px] text-tertiary mb-5 leading-[1.5]">
          Create an unlisted link anyone can use to view this plan.
        </p>

        {hasLinks && (
          <div className="mb-4">
            {shareLinks.map((link: { _id: string; token: string }) => {
              const url = `${appUrl}/shared/${link.token}`;
              return (
                <div
                  key={link._id}
                  className="flex items-center gap-2 py-2 px-2.5 rounded-[7px] border border-border mb-2 bg-bg"
                >
                  <span className="flex-1 text-[12px] text-secondary font-['SF_Mono','JetBrains_Mono',monospace] overflow-hidden text-ellipsis whitespace-nowrap">
                    {url}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(link.token)}
                    className="py-[3px] px-2.5 text-[11.5px] font-medium font-[inherit] rounded-[6px] border border-border bg-transparent cursor-pointer whitespace-nowrap"
                    style={{ color: copiedToken === link.token ? '#16a34a' : 'var(--secondary)' }}
                  >
                    {copiedToken === link.token ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(link._id)}
                    className="py-[3px] px-2.5 text-[11.5px] font-medium font-[inherit] rounded-[6px] border border-border bg-transparent text-[#ef4444] cursor-pointer whitespace-nowrap"
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={handlePublishAndShare}
          disabled={publishing}
          className="w-full py-2 px-4 text-[13px] font-[550] font-[inherit] rounded-lg border-none bg-text text-bg"
          style={{
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
