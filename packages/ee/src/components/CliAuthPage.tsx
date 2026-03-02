import { Skeleton } from '@agendex/web';
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';

interface CliAuthPageProps {
  callbackUrl: string;
}

export function CliAuthPage({ callbackUrl }: CliAuthPageProps) {
  const { user, sessionToken, isLoading, isAuthenticated, signIn } = useAuth();
  const [status, setStatus] = useState<'authenticating' | 'redirecting' | 'error'>(
    'authenticating',
  );

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      signIn.social({ provider: 'github', callbackURL: window.location.href });
      return;
    }

    if (!sessionToken) {
      setStatus('error');
      return;
    }

    setStatus('redirecting');

    const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string;
    const url = new URL(callbackUrl);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      setStatus('error');
      return;
    }
    url.searchParams.set('token', sessionToken);
    url.searchParams.set('convexUrl', convexSiteUrl);
    window.location.href = url.toString();
  }, [isLoading, isAuthenticated, sessionToken, callbackUrl, signIn.social]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center space-y-3">
        <h1 className="font-semibold text-[16px] text-text">Agendex CLI</h1>
        {status === 'authenticating' && (
          <p className="text-[13px] text-tertiary">
            {isLoading ? <Skeleton width="140px" height="14px" /> : 'Redirecting to GitHub...'}
          </p>
        )}
        {status === 'redirecting' && (
          <p className="text-[13px] text-tertiary">
            Authorizing CLI for {user?.name ?? user?.email}...
          </p>
        )}
        {status === 'error' && (
          <p className="text-[13px] text-[#ef4444]">Failed to authorize CLI. Please try again.</p>
        )}
      </div>
    </div>
  );
}
