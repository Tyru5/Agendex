import { Skeleton } from '@agendex/web';
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
      <button
        type="button"
        onClick={() => signIn.social({ provider: 'github', callbackURL: '/' })}
        className="text-[12px] px-2.5 py-1 rounded-[6px] border border-border bg-surface text-text cursor-pointer font-medium"
      >
        Sign in
      </button>
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
              navigate('/settings');
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
