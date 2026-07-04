import { normalizeConvexSiteUrl } from '@agendex/shared/convex-url';
import { GitHubIcon, GoogleIcon, Skeleton } from '@agendex/web';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';
import { AUTH_BASE_URL } from '../lib/auth-client.ts';
import {
  buildDesktopAuthRedirectUrl,
  type DesktopAuthProvider,
  type DesktopAuthRequest,
} from '../lib/desktop-auth-flow.ts';

interface DesktopAuthPageProps {
  readonly authRequest: Extract<DesktopAuthRequest, { readonly ok: true }>;
}

export function DesktopAuthPage({ authRequest }: DesktopAuthPageProps) {
  const { user, sessionToken, isLoading, isAuthenticated, signIn } = useAuth();
  const [status, setStatus] = useState<'choosing' | 'signing-in' | 'redirecting' | 'error'>(
    'choosing',
  );
  const didRedirect = useRef(false);
  const didAutoStart = useRef(false);

  const handleProvider = useCallback(
    (provider: DesktopAuthProvider) => {
      setStatus('signing-in');
      void signIn.social({ provider, callbackURL: window.location.href });
    },
    [signIn],
  );

  useEffect(() => {
    if (didAutoStart.current || isLoading || isAuthenticated) return;
    if (new URLSearchParams(window.location.search).has('ott')) return;
    didAutoStart.current = true;
    handleProvider(authRequest.provider);
  }, [authRequest.provider, handleProvider, isAuthenticated, isLoading]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || didRedirect.current) return;

    if (!sessionToken) {
      setStatus('error');
      return;
    }

    // The desktop main process only trusts callbacks whose `convexUrl` passes
    // the shared normalizer, so validate the origin the auth client actually
    // used before redirecting; a bad value would fail silently after the
    // browser hands off to the app.
    const convexSiteUrl = normalizeConvexSiteUrl(AUTH_BASE_URL);
    if (!convexSiteUrl) {
      setStatus('error');
      return;
    }

    didRedirect.current = true;
    setStatus('redirecting');
    window.location.replace(
      buildDesktopAuthRedirectUrl({
        request: authRequest,
        sessionToken,
        convexSiteUrl,
      }),
    );
  }, [authRequest, isAuthenticated, isLoading, sessionToken]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center space-y-4 max-w-[320px] w-full px-5">
        <h1 className="font-semibold text-[16px] text-text">Agendex Desktop</h1>

        {isLoading && (
          <div className="flex justify-center">
            <Skeleton width="140px" height="14px" />
          </div>
        )}

        {!isLoading && status === 'choosing' && !isAuthenticated && (
          <>
            <p className="text-[13px] text-tertiary">Sign in to authorize the desktop app</p>
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
            Authorizing desktop app for {user?.name ?? user?.email}...
          </p>
        )}

        {status === 'error' && (
          <p className="text-[13px] text-[#ef4444]">
            Failed to authorize the desktop app. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
