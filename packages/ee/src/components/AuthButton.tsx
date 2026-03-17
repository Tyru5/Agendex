import { Skeleton, startViewTransition } from '@agendex/web';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth.ts';

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
          className="text-[12px] px-2.5 py-1 rounded-[6px] border border-border bg-surface text-text cursor-pointer font-medium"
        >
          Sign in
        </button>
        {open && (
          <div
            className="absolute top-full right-0 mt-1.5 bg-surface border border-border rounded-default min-w-[180px] z-[1000] py-1"
            style={{ animation: 'statusPopoverIn 120ms ease-out' }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signIn.social({ provider: 'github', callbackURL: '/' });
              }}
              className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-text text-left cursor-pointer transition-colors duration-150 hover:bg-hover flex items-center gap-2"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="shrink-0"
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Continue with GitHub
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signIn.social({ provider: 'google', callbackURL: '/' });
              }}
              className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-text text-left cursor-pointer transition-colors duration-150 hover:bg-hover flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
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
        className="size-7 rounded-full overflow-hidden cursor-pointer border-none p-0 bg-transparent flex items-center justify-center transition-opacity duration-150 hover:opacity-80"
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
          className="absolute top-full right-0 mt-1.5 bg-surface border border-border rounded-default min-w-[160px] z-[1000] py-1"
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

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="w-full py-2 px-3 border-none bg-transparent text-[13px] text-tertiary text-left cursor-pointer transition-colors duration-150 hover:bg-hover"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
