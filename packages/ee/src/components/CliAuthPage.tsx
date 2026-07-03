import { GitHubIcon, GoogleIcon, Skeleton } from '@agendex/web';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';

interface CliAuthPageProps {
  callbackUrl: string;
}

export function CliAuthPage({ callbackUrl }: CliAuthPageProps) {
  const { user, sessionToken, isLoading, isAuthenticated, signIn } = useAuth();
  const [status, setStatus] = useState<'choosing' | 'signing-in' | 'redirecting' | 'error'>(
    'choosing',
  );
  const didRedirect = useRef(false);

  function handleProvider(provider: 'github' | 'google') {
    setStatus('signing-in');
    signIn.social({ provider, callbackURL: window.location.href });
  }

  useEffect(() => {
    if (isLoading || !isAuthenticated || didRedirect.current) return;

    if (!sessionToken) {
      setStatus('error');
      return;
    }

    didRedirect.current = true;
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
  }, [isLoading, isAuthenticated, sessionToken, callbackUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center space-y-4 max-w-[320px] w-full px-5">
        <h1 className="font-semibold text-[16px] text-text">Agendex CLI</h1>

        {isLoading && (
          <div className="flex justify-center">
            <Skeleton width="140px" height="14px" />
          </div>
        )}

        {!isLoading && status === 'choosing' && !isAuthenticated && (
          <>
            <p className="text-[13px] text-tertiary">Sign in to authorize the CLI</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleProvider('github')}
                className="w-full py-2.5 px-4 rounded-lg border border-border bg-surface text-[13px] text-text font-medium cursor-pointer flex items-center justify-center gap-2 transition-colors duration-150 hover:bg-hover"
              >
                <GitHubIcon size={15} />
                Continue with GitHub
              </button>
              <button
                type="button"
                onClick={() => handleProvider('google')}
                className="w-full py-2.5 px-4 rounded-lg border border-border bg-surface text-[13px] text-text font-medium cursor-pointer flex items-center justify-center gap-2 transition-colors duration-150 hover:bg-hover"
              >
                <GoogleIcon size={15} />
                Continue with Google
              </button>
            </div>
          </>
        )}

        {status === 'signing-in' && (
          <p className="text-[13px] text-tertiary">Redirecting to sign in...</p>
        )}

        {status === 'redirecting' && (
          <p className="text-[13px] text-tertiary">
            Authorizing CLI for {user?.name ?? user?.email}...
          </p>
        )}

        {status === 'error' && (
          <p className="text-[13px] text-[var(--danger)]">
            Failed to authorize CLI. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
