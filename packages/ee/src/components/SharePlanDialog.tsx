import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { usePublishing } from '../hooks/usePublishing.ts';
import { timeAgo } from '../lib/formatTime.ts';

const appUrl = (import.meta.env.VITE_APP_URL as string) || window.location.origin;

type ShareLinkRow = {
  _id: string;
  token: string;
  createdAt: number;
  hasPassword: boolean;
};

export function SharePlanDialog({
  plan,
  mode,
  onClose,
}: {
  plan: Plan;
  mode: 'local' | 'cloud';
  onClose: () => void;
}) {
  const { publish } = usePublishing();
  const createShareLink = useAction(api.sharing.createShareLink);
  const revokeShareLink = useMutation(api.sharing.revokeShareLink);

  const [publishedPlanId, setPublishedPlanId] = useState<string | null>(
    mode === 'cloud' ? plan.id : null,
  );
  const [publishing, setPublishing] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<'password' | 'both' | null>(null);
  const [protectWithPassword, setProtectWithPassword] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState<{
    url: string;
    password: string;
  } | null>(null);

  useEffect(() => {
    setPublishedPlanId(mode === 'cloud' ? plan.id : null);
    setCopiedToken(null);
    setOneTimeSecret(null);
    setCopiedSecret(null);
  }, [mode, plan.id]);

  const shareLinks = useQuery(
    api.sharing.getShareLinks,
    publishedPlanId ? { planId: publishedPlanId as Id<'plans'> } : 'skip',
  );

  async function handlePublishAndShare() {
    setPublishing(true);
    try {
      let planId = publishedPlanId;
      if (!planId) {
        const result = await publish(plan);
        planId =
          (result as { _id?: string; planId?: string })?._id ??
          (result as { planId?: string })?.planId ??
          (result as string);
      }
      setPublishedPlanId(planId as string);
      const result = await createShareLink({
        planId: planId as Id<'plans'>,
        ...(protectWithPassword ? { protectWithPassword: true } : {}),
      });
      const url = `${appUrl}/shared/${result.token}`;
      setCopiedSecret(null);
      if ('password' in result && result.password) {
        setOneTimeSecret({ url, password: result.password });
      } else {
        setOneTimeSecret(null);
      }
      setProtectWithPassword(false);
    } finally {
      setPublishing(false);
    }
  }

  async function handleCopyLink(token: string) {
    const url = `${appUrl}/shared/${token}`;
    await navigator.clipboard.writeText(url);

    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  async function handleCopyPassword() {
    if (!oneTimeSecret) return;

    await navigator.clipboard.writeText(oneTimeSecret.password);
    setCopiedSecret('password');

    setTimeout(() => setCopiedSecret(null), 2000);
  }

  async function handleCopyBoth() {
    if (!oneTimeSecret) return;

    const text = `Link:\n${oneTimeSecret.url}\n\nPassword:\n${oneTimeSecret.password}`;
    await navigator.clipboard.writeText(text);
    setCopiedSecret('both');

    setTimeout(() => setCopiedSecret(null), 2000);
  }

  async function handleRevoke(linkId: string, token: string) {
    await revokeShareLink({ shareLinkId: linkId as Id<'shareLinks'> });
    const revokedUrl = `${appUrl}/shared/${token}`;

    let clearedOneTimeBanner = false;
    setOneTimeSecret((prev) => {
      if (prev?.url === revokedUrl) {
        clearedOneTimeBanner = true;
        return null;
      }
      return prev;
    });

    if (clearedOneTimeBanner) setCopiedSecret(null);
  }

  const hasLinks = shareLinks && shareLinks.length > 0;
  const buttonLabel = publishing
    ? 'Publishing…'
    : hasLinks
      ? 'Create another link'
      : publishedPlanId
        ? 'Create share link'
        : 'Publish & share';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[6px] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="relative w-full max-w-[480px] bg-surface border border-border rounded-2xl py-8 px-8 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.25)]">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-lg border-none bg-transparent text-tertiary hover:text-secondary cursor-pointer flex items-center justify-center text-[20px] leading-none font-[inherit] transition-colors"
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex items-start gap-3 mb-2 pr-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--text)_8%,transparent)]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-5 w-5 text-text"
              aria-hidden
            >
              <title>Share</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 5.314 5.314 5.314m0 0 5.314-5.314m-5.314 5.314L12 12.75l-4.757-4.757"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-text tracking-[-0.02em] leading-tight">
              Share plan
            </h2>
            <p className="text-[13px] text-tertiary mt-1 leading-[1.5]">
              Anyone with the link can view this plan. Links are unlisted and not searchable.
            </p>
          </div>
        </div>

        {oneTimeSecret && (
          <div className="mt-5 mb-5 rounded-xl border border-border bg-bg p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-secondary mb-1">
              Save this password
            </p>
            <p className="text-[12.5px] text-tertiary leading-[1.5] mb-3">
              This is the only time we show it. You cannot recover it later—copy it now or revoke
              the link and create a new one.
            </p>
            <div className="rounded-lg border border-border bg-surface px-3 py-2.5 mb-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-tertiary mb-1">
                Password
              </p>
              <p className="text-[13px] font-['SF_Mono','JetBrains_Mono',monospace] text-text break-all select-all">
                {oneTimeSecret.password}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyPassword}
                className="py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-text text-bg cursor-pointer"
              >
                {copiedSecret === 'password' ? 'Copied' : 'Copy password'}
              </button>
              <button
                type="button"
                onClick={handleCopyBoth}
                className="py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent text-secondary cursor-pointer"
              >
                {copiedSecret === 'both' ? 'Copied' : 'Copy link + password'}
              </button>
              <button
                type="button"
                onClick={() => setOneTimeSecret(null)}
                className="py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border-none bg-transparent text-tertiary cursor-pointer ml-auto"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {hasLinks && (
          <div className="mb-5 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
              Active links
            </p>
            {shareLinks.map((link: ShareLinkRow) => {
              const url = `${appUrl}/shared/${link.token}`;
              return (
                <div
                  key={link._id}
                  className="rounded-xl border border-border bg-bg p-3.5 shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--border)_60%,transparent)]"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] text-tertiary tabular-nums">
                      {timeAgo(link.createdAt)}
                    </span>
                    {link.hasPassword && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-secondary">
                        <svg
                          aria-hidden
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-3.5 h-3.5 opacity-70"
                        >
                          <title>Lock</title>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75c0 .621.504 1.125 1.125 1.125Z"
                          />
                        </svg>
                        Password
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] font-['SF_Mono','JetBrains_Mono',monospace] text-secondary break-all leading-snug mb-3">
                    {url}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyLink(link.token)}
                      className="py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-text text-bg cursor-pointer"
                    >
                      {copiedToken === link.token ? 'Copied link' : 'Copy link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(link._id, link.token)}
                      className="py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent cursor-pointer text-[#ef4444]"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-5 rounded-xl border border-border p-4 bg-[color-mix(in_srgb,var(--text)_3%,transparent)]">
          <label className="flex items-start gap-3.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={protectWithPassword}
              onChange={(e) => setProtectWithPassword(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded-[4px] border border-border accent-text cursor-pointer"
            />
            <div>
              <span className="block text-[13px] font-medium text-text">Require password</span>
              <span className="block text-[12px] text-tertiary mt-0.5 leading-snug">
                A unique password is generated for this link only.
              </span>
            </div>
          </label>
        </div>

        <button
          type="button"
          onClick={handlePublishAndShare}
          disabled={publishing}
          className="w-full py-2.5 px-4 text-[13px] font-semibold font-[inherit] rounded-xl border-none bg-text text-bg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
