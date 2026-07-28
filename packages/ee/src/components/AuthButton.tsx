import {
  GitHubIcon,
  GoogleIcon,
  Skeleton,
  startViewTransition,
  type ThemePreference,
  useTheme,
} from '@agendex/web';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth.ts';
import { useSubscription } from '../hooks/useSubscription';
import { APP_URL } from '../lib/auth-client.ts';
import { PricingModal } from './PricingModal';

const DASHBOARD_PATH = '/dashboard';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function SignOutIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M21 19V5a2 2 0 0 0-2-2h-5" />
      <path d="M14 21h5a2 2 0 0 0 2-2" />
    </svg>
  );
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-text text-left cursor-pointer transition-colors duration-150 hover:bg-hover"
    >
      {children}
    </button>
  );
}

export function AuthButton() {
  const { user, isLoading, isAuthenticated, signIn, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { subscription, isActive, isTrialing, trialDaysLeft, createPortal, reactivate } =
    useSubscription({ enabled: isAuthenticated });
  const [open, setOpen] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (isLoading) {
    return <Skeleton width="28px" height="28px" borderRadius="50%" />;
  }

  if (!isAuthenticated) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="agendex-topbar-button text-[12px] h-[30px] px-2.5 rounded-lg border border-border cursor-pointer font-medium"
        >
          Sign in
        </button>
        {open && (
          <div
            className="agendex-popover agendex-popover--enter absolute top-full right-0 mt-1.5 rounded-default min-w-[200px] z-[1000] py-1"
            role="menu"
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signIn.social({ provider: 'github', callbackURL: `${APP_URL}${DASHBOARD_PATH}` });
              }}
              className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-text text-left cursor-pointer transition-colors duration-150 hover:bg-hover flex items-center gap-2"
            >
              <GitHubIcon size={14} />
              Continue with GitHub
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signIn.social({ provider: 'google', callbackURL: `${APP_URL}${DASHBOARD_PATH}` });
              }}
              className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-text text-left cursor-pointer transition-colors duration-150 hover:bg-hover flex items-center gap-2"
            >
              <GoogleIcon size={14} />
              Continue with Google
            </button>
            <div className="mx-1 my-1 h-px bg-border" />
            <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-tertiary">Theme</div>
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setTheme(opt.value);
                }}
                className="w-full flex items-center justify-between gap-2 py-1.5 px-3 border-none bg-transparent text-[12.5px] text-left cursor-pointer hover:bg-hover"
                style={{
                  fontWeight: theme === opt.value ? 550 : 400,
                  color: theme === opt.value ? 'var(--text)' : 'var(--secondary)',
                }}
              >
                {opt.label}
                {theme === opt.value && (
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                    stroke="currentColor"
                    className="w-3 h-3"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase();
  const cancelAtPeriodEnd = Boolean(subscription?.cancelAtPeriodEnd);
  const endDate = subscription
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Account menu"
          className="size-[30px] rounded-full overflow-hidden cursor-pointer border border-border p-0 bg-transparent flex items-center justify-center transition-[border-color,opacity] duration-150 hover:opacity-90 hover:border-[var(--border-strong)]"
        >
          {user?.image ? (
            <img src={user.image} alt="" className="size-[30px] rounded-full object-cover" />
          ) : (
            <div className="size-[30px] rounded-full bg-border flex items-center justify-center text-[11px] font-semibold text-secondary">
              {initial}
            </div>
          )}
        </button>

        {open && (
          <div
            className="agendex-popover agendex-popover--enter absolute top-full right-0 mt-1.5 rounded-default min-w-[220px] z-[1000] py-1"
            role="menu"
          >
            <div className="px-3 py-2 border-b border-border">
              <div className="text-[12px] font-medium text-text truncate max-w-[190px]">
                {user?.name || 'Account'}
              </div>
              {user?.email && (
                <div className="text-[11px] text-tertiary truncate max-w-[190px]">{user.email}</div>
              )}
              {(isActive || isTrialing) && (
                <div className="mt-1.5 text-[11px] text-secondary">
                  {isTrialing
                    ? `Trial · ${trialDaysLeft}d left`
                    : cancelAtPeriodEnd
                      ? `Pro until ${endDate}`
                      : 'Pro'}
                </div>
              )}
            </div>

            <MenuItem
              onClick={() => {
                setOpen(false);
                startViewTransition(() => navigate('/settings'));
              }}
            >
              Settings
            </MenuItem>

            {isActive && !isTrialing && subscription && (
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  void createPortal();
                }}
              >
                Manage billing
              </MenuItem>
            )}

            {cancelAtPeriodEnd && (
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  void reactivate();
                }}
              >
                Reactivate Pro
              </MenuItem>
            )}

            {(!isActive || isTrialing) && (
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  setShowPricing(true);
                }}
              >
                {isTrialing ? 'Upgrade to Pro' : 'View plans'}
              </MenuItem>
            )}

            <div className="mx-1 my-1 h-px bg-border" />
            <div className="px-3 pt-1 pb-1 text-[11px] font-medium text-tertiary">Theme</div>
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className="w-full flex items-center justify-between gap-2 py-1.5 px-3 border-none bg-transparent text-[12.5px] text-left cursor-pointer hover:bg-hover"
                style={{
                  fontWeight: theme === opt.value ? 550 : 400,
                  color: theme === opt.value ? 'var(--text)' : 'var(--secondary)',
                }}
              >
                {opt.label}
                {theme === opt.value && (
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                    stroke="currentColor"
                    className="w-3 h-3"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
            ))}

            <div className="mx-1 my-1 h-px bg-border" />

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="group mx-1 flex w-[calc(100%-8px)] cursor-pointer items-center justify-between gap-3 rounded-[7px] border border-transparent px-2.5 py-2 text-left text-[13px] font-medium text-tertiary transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-[color-mix(in_oklch,var(--danger)_24%,var(--border))] hover:bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklch,var(--accent)_55%,var(--border))] active:translate-y-px"
              aria-label="Sign out of Agendex"
            >
              <span>Sign out</span>
              <span
                className="text-secondary transition-colors duration-150 group-hover:text-[var(--danger)]"
                aria-hidden="true"
              >
                <SignOutIcon />
              </span>
            </button>
          </div>
        )}
      </div>
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </>
  );
}
