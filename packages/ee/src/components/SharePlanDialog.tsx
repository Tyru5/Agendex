import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { usePublishing } from '../hooks/usePublishing.ts';

const appUrl = (import.meta.env.VITE_APP_URL as string) || window.location.origin;

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
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    setPublishedPlanId(mode === 'cloud' ? plan.id : null);
    setCopiedToken(null);
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
      await createShareLink({
        planId: planId as Id<'plans'>,
        password: passwordEnabled && password.length > 0 ? password : undefined,
      });
      setPassword('');
      setPasswordEnabled(false);
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
  const buttonLabel = publishing
    ? 'Publishing…'
    : hasLinks
      ? 'Create Another Link'
      : publishedPlanId
        ? 'Create Share Link'
        : 'Publish & Share';

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
            {shareLinks.map((link: { _id: string; token: string; hasPassword: boolean }) => {
              const url = `${appUrl}/shared/${link.token}`;
              return (
                <div
                  key={link._id}
                  className="flex items-center gap-2 py-2 px-2.5 rounded-[7px] border border-border mb-2 bg-bg"
                >
                  {link.hasPassword && (
                    <svg
                      aria-label="Password protected"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-3.5 h-3.5 text-tertiary shrink-0"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                      />
                    </svg>
                  )}
                  <span className="flex-1 text-[12px] text-secondary font-['SF_Mono','JetBrains_Mono',monospace] overflow-hidden text-ellipsis whitespace-nowrap">
                    {url}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(link.token)}
                    className="py-[3px] px-2.5 text-[11.5px] font-medium font-[inherit] rounded-[6px] border border-border bg-transparent cursor-pointer whitespace-nowrap"
                    style={{
                      color: copiedToken === link.token ? '#16a34a' : 'var(--secondary)',
                    }}
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

        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={passwordEnabled}
              onChange={(e) => {
                setPasswordEnabled(e.target.checked);
                if (!e.target.checked) setPassword('');
              }}
              className="w-3.5 h-3.5 accent-text cursor-pointer"
            />
            <span className="text-[12.5px] text-secondary font-medium">Protect with password</span>
          </label>
          {passwordEnabled && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a password"
              autoComplete="new-password"
              className="mt-2 w-full py-1.5 px-2.5 text-[12.5px] font-[inherit] rounded-[7px] border border-border bg-bg text-text outline-none placeholder:text-tertiary"
            />
          )}
        </div>

        <button
          type="button"
          onClick={handlePublishAndShare}
          disabled={publishing || (passwordEnabled && password.length === 0)}
          className="w-full py-2 px-4 text-[13px] font-[550] font-[inherit] rounded-lg border-none bg-text text-bg"
          style={{
            cursor:
              publishing || (passwordEnabled && password.length === 0) ? 'not-allowed' : 'pointer',
            opacity: publishing || (passwordEnabled && password.length === 0) ? 0.6 : 1,
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
