import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';
import { Skeleton } from './Skeleton.tsx';

interface CliAuthPageProps {
  callbackUrl: string;
}

export function CliAuthPage({ callbackUrl }: CliAuthPageProps) {
  const { user, isLoading, isAuthenticated, signIn } = useAuth();
  const [status, setStatus] = useState<'authenticating' | 'redirecting' | 'error'>(
    'authenticating',
  );

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      signIn.social({ provider: 'github', callbackURL: window.location.href });
      return;
    }

    setStatus('redirecting');

    const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string;

    fetch(`${convexSiteUrl}/api/auth/get-session`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.json())
      .then((data: { session?: { token?: string } }) => {
        const token = data?.session?.token;
        if (!token) {
          setStatus('error');
          return;
        }

        const url = new URL(callbackUrl);
        if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
          setStatus('error');
          return;
        }
        url.searchParams.set('token', token);
        url.searchParams.set('convexUrl', convexSiteUrl);
        window.location.href = url.toString();
      })
      .catch(() => {
        setStatus('error');
      });
  }, [isLoading, isAuthenticated, callbackUrl, signIn.social]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div className="text-center space-y-3">
        <h1 className="font-semibold" style={{ fontSize: '16px', color: 'var(--text)' }}>
          Agendex CLI
        </h1>
        {status === 'authenticating' && (
          <p style={{ fontSize: '13px', color: 'var(--tertiary)' }}>
            {isLoading ? <Skeleton width="140px" height="14px" /> : 'Redirecting to GitHub...'}
          </p>
        )}
        {status === 'redirecting' && (
          <p style={{ fontSize: '13px', color: 'var(--tertiary)' }}>
            Authorizing CLI for {user?.name ?? user?.email}...
          </p>
        )}
        {status === 'error' && (
          <p style={{ fontSize: '13px', color: '#ef4444' }}>
            Failed to authorize CLI. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
