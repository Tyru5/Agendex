import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { startViewTransition } from '@agendex/web';
import { useLocation } from 'wouter';
import { PRIMARY_CONTRAST_FALLBACK } from './settings/constants';

interface LocalIpDisclosureNoticeProps {
  enabled: boolean;
}

const EXIT_ANIMATION_MS = 180;

export function LocalIpDisclosureNotice({ enabled }: LocalIpDisclosureNoticeProps) {
  const [, navigate] = useLocation();
  const prefs = useQuery(api.account.getMyPrivacyPreferences, enabled ? {} : 'skip');
  const updatePrivacyPreferences = useMutation(api.account.updatePrivacyPreferences);
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  if (
    !enabled ||
    hidden ||
    prefs === undefined ||
    prefs === null ||
    (prefs.localIpDisclosureAcknowledgedAt && !dismissing)
  ) {
    return null;
  }

  function waitForExitAnimation(): Promise<void> {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise((resolve) => {
      window.setTimeout(resolve, reduceMotion ? 0 : EXIT_ANIMATION_MS);
    });
  }

  async function dismissAfter(updatePreferences: () => Promise<unknown>) {
    setSaving(true);
    setDismissing(true);
    try {
      await Promise.all([updatePreferences(), waitForExitAnimation()]);
      setHidden(true);
    } catch {
      setDismissing(false);
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge() {
    await dismissAfter(() => updatePrivacyPreferences({ acknowledgeLocalIpDisclosure: true }));
  }

  async function turnOff() {
    await dismissAfter(() =>
      updatePrivacyPreferences({
        collectLocalIpAddress: false,
        acknowledgeLocalIpDisclosure: true,
      }),
    );
  }

  function openSettings() {
    setDismissing(true);
    void waitForExitAnimation().then(() => {
      startViewTransition(() => navigate('/settings'));
    });
  }

  return (
    <div
      className="local-ip-disclosure fixed bottom-4 right-4 z-[70] w-[min(420px,calc(100vw-32px))] rounded-xl border border-border bg-surface p-4 shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
      data-state={dismissing ? 'closing' : 'open'}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-text">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text">Sync provenance update</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-secondary">
            Cloud sync can include this machine's local IP address with plan and machine metadata.
            You can turn it off now or change it later in Account settings.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={turnOff}
              disabled={saving}
              className="local-ip-disclosure-action rounded-default border border-border bg-transparent px-3 py-1.5 text-[12px] font-semibold text-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Turn off
            </button>
            <button
              type="button"
              onClick={openSettings}
              disabled={saving}
              className="local-ip-disclosure-action rounded-default border border-border bg-transparent px-3 py-1.5 text-[12px] font-semibold text-secondary hover:bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={acknowledge}
              disabled={saving}
              className="local-ip-disclosure-action rounded-default border border-transparent px-3 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: 'var(--primary)',
                color: `var(--accent-contrast, ${PRIMARY_CONTRAST_FALLBACK})`,
              }}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
