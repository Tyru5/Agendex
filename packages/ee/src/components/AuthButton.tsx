import { GitHubIcon, GoogleIcon, Skeleton, startViewTransition } from '@agendex/web';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { APP_URL } from '../lib/auth-client.ts';
import { useAuth } from '../hooks/useAuth.ts';

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

export function AuthButton() {
  const { user, isLoading, isAuthenticated, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
          className="agendex-topbar-button text-[12px] px-2.5 py-1 rounded-[6px] border border-border cursor-pointer font-medium"
        >
          Sign in
        </button>
        {open && (
          <div
            className="agendex-popover absolute top-full right-0 mt-1.5 rounded-default min-w-[180px] z-[1000] py-1"
            style={{ animation: 'statusPopoverIn 120ms ease-out' }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signIn.social({ provider: 'github', callbackURL: `${APP_URL}/` });
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
                signIn.social({ provider: 'google', callbackURL: `${APP_URL}/` });
              }}
              className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-text text-left cursor-pointer transition-colors duration-150 hover:bg-hover flex items-center gap-2"
            >
              <GoogleIcon size={14} />
              Continue with Google
            </button>
          </div>
        )}
      </div>
    );
  }

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="size-7 rounded-full overflow-hidden cursor-pointer border border-border p-0 bg-transparent flex items-center justify-center transition-[border-color,opacity] duration-150 hover:opacity-90 hover:border-[var(--border-strong)]"
      >
        {user?.image ? (
          <img src={user.image} alt="" className="size-7 rounded-full object-cover" />
        ) : (
          <div className="size-7 rounded-full bg-border flex items-center justify-center text-[11px] font-semibold text-secondary">
            {initial}
          </div>
        )}
      </button>

      {open && (
        <div
          className="agendex-popover absolute top-full right-0 mt-1.5 rounded-default min-w-[160px] z-[1000] py-1"
          style={{ animation: 'statusPopoverIn 120ms ease-out' }}
        >
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[12px] font-medium text-text truncate max-w-[140px]">
              {user?.name || 'Account'}
            </div>
            {user?.email && (
              <div className="text-[11px] text-tertiary truncate max-w-[140px]">{user.email}</div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              startViewTransition(() => navigate('/settings'));
            }}
            className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-text text-left cursor-pointer transition-colors duration-150 hover:bg-hover"
          >
            Settings
          </button>

          <div className="mx-1 my-1 h-px bg-border" />

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="mx-1 flex w-[calc(100%-8px)] cursor-pointer items-center justify-between gap-3 rounded-[7px] border border-transparent px-2.5 py-2 text-left text-[13px] font-medium text-tertiary transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-border hover:bg-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklch,var(--accent)_55%,var(--border))] active:translate-y-px"
            aria-label="Sign out of Agendex"
          >
            <span>Sign out</span>
            <span className="text-secondary transition-colors duration-150" aria-hidden="true">
              <SignOutIcon />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
