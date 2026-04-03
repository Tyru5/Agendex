import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAction, useMutation, useQuery } from 'convex/react';
import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePublishing } from '../hooks/usePublishing.ts';
import { timeAgo } from '../lib/formatTime.ts';

const appUrl = (import.meta.env.VITE_APP_URL as string) || window.location.origin;

/** Slightly longer than `share-panel-out` (240ms) so the panel finishes before unmount. */
const SHARE_DIALOG_EXIT_MS = 280;

type ShareLinkRow = {
  _id: string;
  token: string;
  createdAt: number;
  hasPassword: boolean;
};

/** Box + outgoing stroke — same metaphor as “open link,” lighter than the old share-node glyph. */
function LinkOutIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <title>Public link</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 13v6a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 19V8.25A2.25 2.25 0 0 1 6 6h6"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 13.5 21 3" />
    </svg>
  );
}

async function trySystemShare(url: string, title: string): Promise<boolean> {
  if (typeof navigator.share !== 'function') return false;
  const payload: ShareData = { title, text: title, url };
  try {
    if (navigator.canShare && !navigator.canShare(payload)) return false;
    await navigator.share(payload);
    return true;
  } catch {
    return false;
  }
}

type SharePlanDialogProps = {
  plan: Plan;
  mode: 'local' | 'cloud';
  onClose: () => void;
};

export function SharePlanDialog({ plan, mode, onClose }: SharePlanDialogProps) {
  const titleId = useId();
  const descId = useId();
  const { publish } = usePublishing();
  const createShareLink = useAction(api.sharing.createShareLink);
  const revokeShareLink = useMutation(api.sharing.revokeShareLink);

  const [publishedPlanId, setPublishedPlanId] = useState<string | null>(
    mode === 'cloud' ? plan.id : null,
  );
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<'password' | 'both' | null>(null);
  const [protectWithPassword, setProtectWithPassword] = useState(false);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<{
    url: string;
    password: string;
  } | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = reduced ? 0 : SHARE_DIALOG_EXIT_MS;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, ms);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setPublishedPlanId(mode === 'cloud' ? plan.id : null);
    setCopiedToken(null);
    setOneTimeSecret(null);
    setCopiedSecret(null);
    setPublishError(null);
    setRevokeConfirmId(null);
  }, [mode, plan.id]);

  const shareLinks = useQuery(
    api.sharing.getShareLinks,
    publishedPlanId ? { planId: publishedPlanId as Id<'plans'> } : 'skip',
  );

  async function handlePublishAndShare() {
    setPublishing(true);
    setPublishError(null);
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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not create share link. Try again.';
      setPublishError(message);
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
    setRevokeConfirmId((id) => (id === linkId ? null : id));
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

  const canNativeShare = typeof navigator.share === 'function';

  const btnMotion =
    'select-none transition-[transform,opacity,colors] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] disabled:active:scale-100';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy={closing}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 pointer-events-none"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          requestClose();
        }
      }}
    >
      <div
        className={`share-dialog-overlay absolute inset-0 z-0 cursor-default bg-black/55 ${closing ? 'share-dialog-exiting pointer-events-none' : 'pointer-events-auto'}`}
        onClick={requestClose}
        role="presentation"
        aria-hidden
      />
      <div
        className={`share-dialog-panel relative z-[1] w-full max-w-[480px] bg-surface border border-border rounded-2xl py-7 px-7 sm:py-8 sm:px-8 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.35)] ${closing ? 'share-dialog-exiting pointer-events-none' : 'pointer-events-auto'}`}
      >
        <button
          type="button"
          onClick={requestClose}
          className={`absolute top-3.5 right-3.5 w-8 h-8 rounded-lg border-none bg-transparent text-tertiary hover:text-secondary cursor-pointer flex items-center justify-center text-[20px] leading-none font-[inherit] transition-colors duration-200 ${btnMotion}`}
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex items-start gap-3 mb-1 pr-8">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--text)_8%,transparent)]">
            <LinkOutIcon className="h-[18px] w-[18px] text-text" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-[17px] font-semibold text-text tracking-[-0.02em] leading-tight"
            >
              Share plan
            </h2>
            <p
              className="text-[12.5px] text-secondary mt-1 leading-snug truncate"
              title={plan.title}
            >
              {plan.title}
            </p>
            <p id={descId} className="text-[13px] text-tertiary mt-2 leading-[1.5]">
              Anyone with the link can view this plan. Links are unlisted and not searchable.
            </p>
          </div>
        </div>

        {oneTimeSecret && (
          <div className="share-reveal mt-5 mb-5 rounded-xl border border-border border-l-[3px] border-l-[color-mix(in_srgb,var(--text)_32%,transparent)] bg-bg px-4 py-3.5 [--share-delay:45ms]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-secondary mb-1">
              Save this password
            </p>
            <p className="text-[12.5px] text-tertiary leading-[1.5] mb-3">
              This is the only time we show it. You cannot recover it later—copy it now or revoke
              the link and create a new one.
            </p>
            <label htmlFor="share-dialog-new-url" className="sr-only">
              Share URL
            </label>
            <input
              id="share-dialog-new-url"
              readOnly
              value={oneTimeSecret.url}
              onFocus={(e) => e.target.select()}
              className="w-full mb-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-['JetBrains_Mono','SF_Mono',ui-monospace,monospace] text-secondary outline-none focus:border-text"
            />
            <label htmlFor="share-dialog-new-password" className="sr-only">
              Password
            </label>
            <input
              id="share-dialog-new-password"
              readOnly
              value={oneTimeSecret.password}
              onFocus={(e) => e.target.select()}
              className="w-full mb-3 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-['JetBrains_Mono','SF_Mono',ui-monospace,monospace] text-text outline-none focus:border-text"
            />
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={handleCopyPassword}
                className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-text text-bg cursor-pointer ${btnMotion}`}
              >
                {copiedSecret === 'password' ? 'Copied' : 'Copy password'}
              </button>
              <button
                type="button"
                onClick={handleCopyBoth}
                className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent text-secondary cursor-pointer ${btnMotion}`}
              >
                {copiedSecret === 'both' ? 'Copied' : 'Copy link + password'}
              </button>
              {canNativeShare && (
                <button
                  type="button"
                  onClick={() => trySystemShare(oneTimeSecret.url, plan.title)}
                  className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent text-secondary cursor-pointer ${btnMotion}`}
                >
                  Share via…
                </button>
              )}
              <button
                type="button"
                onClick={() => setOneTimeSecret(null)}
                className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border-none bg-transparent text-tertiary cursor-pointer sm:ml-auto ${btnMotion}`}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {hasLinks && (
          <div className="share-reveal mb-5 [--share-delay:60ms]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary mb-2">
              Active links
            </p>
            <div className="rounded-xl border border-border divide-y divide-border bg-bg overflow-hidden">
              {shareLinks.map((link: ShareLinkRow, rowIndex: number) => {
                const url = `${appUrl}/shared/${link.token}`;
                const inputId = `share-link-url-${link._id}`;
                const confirming = revokeConfirmId === link._id;
                return (
                  <div
                    key={link._id}
                    className="share-link-row p-3.5"
                    style={
                      { '--share-row-delay': `${Math.min(rowIndex, 8) * 42}ms` } as CSSProperties
                    }
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
                    <label htmlFor={inputId} className="sr-only">
                      Link URL
                    </label>
                    <input
                      id={inputId}
                      readOnly
                      value={url}
                      onFocus={(e) => e.target.select()}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-['JetBrains_Mono','SF_Mono',ui-monospace,monospace] text-secondary outline-none focus:border-text mb-3"
                    />
                    {confirming ? (
                      <div
                        key="revoke-confirm"
                        className="share-reveal flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
                      >
                        <p className="text-[12px] text-tertiary w-full sm:w-auto">
                          This link stops working immediately.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setRevokeConfirmId(null)}
                            className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent text-secondary cursor-pointer ${btnMotion}`}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(link._id, link.token)}
                            className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent cursor-pointer text-[#ef4444] ${btnMotion}`}
                          >
                            Revoke link
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key="revoke-actions" className="share-reveal flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyLink(link.token)}
                          className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-text text-bg cursor-pointer ${btnMotion}`}
                        >
                          {copiedToken === link.token ? 'Copied link' : 'Copy link'}
                        </button>
                        {canNativeShare && (
                          <button
                            type="button"
                            onClick={() => trySystemShare(url, plan.title)}
                            className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent text-secondary cursor-pointer ${btnMotion}`}
                          >
                            Share via…
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setRevokeConfirmId(link._id)}
                          className={`py-1.5 px-3 text-[12px] font-medium font-[inherit] rounded-lg border border-border bg-transparent cursor-pointer text-[#ef4444] ${btnMotion}`}
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {publishError && (
          <p
            className="share-reveal text-[12px] text-[#ef4444] mb-3 [--share-delay:0ms]"
            role="alert"
          >
            {publishError}
          </p>
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
          className={`w-full py-2.5 px-4 text-[13px] font-semibold font-[inherit] rounded-xl border-none bg-text text-bg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-opacity duration-200 ease-out ${btnMotion}`}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
