import { GitHubIcon, GoogleIcon, startViewTransition } from '@agendex/web';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth.ts';
import { APP_URL } from '../lib/auth-client.ts';

const DASHBOARD_PATH = '/dashboard';

type AuthMode = 'login' | 'signup';
type AuthProvider = 'github' | 'google';

function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 animate-spin"
      style={{ animationDuration: '0.8s' }}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color ?? 'currentColor'}
        strokeWidth="3"
        opacity={0.25}
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={color ?? 'currentColor'}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AuthProviderButton({
  provider,
  activeProvider,
  onClick,
}: {
  provider: AuthProvider;
  activeProvider: AuthProvider | null;
  onClick: (provider: AuthProvider) => void;
}) {
  const isActive = activeProvider === provider;
  const isDisabled = activeProvider !== null;
  const label = provider === 'github' ? 'Continue with GitHub' : 'Continue with Google';
  const Icon = provider === 'github' ? GitHubIcon : GoogleIcon;

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => onClick(provider)}
      className="group flex w-full items-center justify-between rounded-[10px] border border-[oklch(90%_0.01_145_/_0.13)] bg-[oklch(20%_0.025_178)] px-4 py-3 text-left text-[13.5px] font-semibold text-[oklch(94%_0.014_125)] transition-[background-color,border-color,opacity] duration-200 ease-out hover:border-[oklch(90%_0.22_129_/_0.34)] hover:bg-[oklch(23%_0.026_178)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(90%_0.22_129)] disabled:cursor-default disabled:opacity-65"
    >
      <span className="flex items-center gap-3">
        {isActive ? <Spinner size={16} /> : <Icon size={17} />}
        {isActive ? 'Redirecting...' : label}
      </span>
      <span className="text-[15px] text-[oklch(67%_0.025_165)]" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { isAuthenticated, isLoading, signIn } = useAuth();
  const [, navigate] = useLocation();
  const didRedirectRef = useRef(false);
  const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = useMemo(
    () =>
      mode === 'signup'
        ? {
            eyebrow: 'Create account',
            title: 'Start with Agendex.',
            body: 'Use GitHub or Google. No password to set up.',
            switchLabel: 'Already have access?',
            switchCta: 'Sign in',
            switchHref: '/login',
          }
        : {
            eyebrow: 'Welcome back',
            title: 'Sign in to Agendex.',
            body: 'Return to your plans, shared reviews, and sync state.',
            switchLabel: 'New to Agendex?',
            switchCta: 'Sign up',
            switchHref: '/signup',
          },
    [mode],
  );

  useEffect(() => {
    if (!isAuthenticated || didRedirectRef.current) return;

    didRedirectRef.current = true;
    startViewTransition(() => navigate(DASHBOARD_PATH));
  }, [isAuthenticated, navigate]);

  if (isAuthenticated || isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[oklch(16%_0.026_178)] px-5 py-10 text-[oklch(94%_0.014_125)]">
        <div
          className="flex items-center gap-3 rounded-[18px] border border-[oklch(90%_0.01_145_/_0.14)] bg-[oklch(18.5%_0.027_178)] px-5 py-4 text-[13.5px] text-[oklch(67%_0.025_165)] shadow-[0_18px_40px_oklch(8%_0.02_178_/_0.34)]"
          aria-busy="true"
          role="status"
        >
          <Spinner size={16} />
          Checking your session…
        </div>
      </main>
    );
  }

  async function handleProvider(provider: AuthProvider) {
    setActiveProvider(provider);
    setError(null);
    try {
      await signIn.social({ provider, callbackURL: `${APP_URL}${DASHBOARD_PATH}` });
    } catch {
      setActiveProvider(null);
      setError('Could not start OAuth. Try again in a moment.');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[oklch(16%_0.026_178)] px-5 py-10 text-[oklch(94%_0.014_125)]">
      <section className="w-full max-w-[396px]">
        <div className="rounded-[18px] border border-[oklch(90%_0.01_145_/_0.14)] bg-[oklch(18.5%_0.027_178)] p-6 shadow-[0_18px_40px_oklch(8%_0.02_178_/_0.34)] max-sm:p-5">
          <div className="mb-7 text-center">
            <p className="m-0 text-[12px] font-semibold text-[oklch(90%_0.22_129)]">
              {copy.eyebrow}
            </p>
            <h1 className="mt-3 mb-0 text-[24px] font-[650] leading-[1.16] tracking-[-0.02em] text-[oklch(94%_0.014_125)]">
              {copy.title}
            </h1>
            <p className="mx-auto mt-3 mb-0 max-w-[32ch] text-[13.5px] leading-[1.55] text-[oklch(67%_0.025_165)]">
              {copy.body}
            </p>
          </div>

          <div className="space-y-3" aria-busy={activeProvider !== null || isLoading}>
            <AuthProviderButton
              provider="github"
              activeProvider={activeProvider}
              onClick={handleProvider}
            />
            <AuthProviderButton
              provider="google"
              activeProvider={activeProvider}
              onClick={handleProvider}
            />
          </div>

          {error && (
            <div
              className="mt-4 rounded-[8px] border border-[oklch(64%_0.2_27_/_0.36)] bg-[oklch(35%_0.08_27_/_0.24)] px-3 py-2 text-[12.5px] text-[oklch(86%_0.07_27)]"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="mt-6 border-t border-[oklch(90%_0.01_145_/_0.11)] pt-4 text-center text-[12.5px] text-[oklch(67%_0.025_165)]">
            {copy.switchLabel}{' '}
            <Link
              href={copy.switchHref}
              onClick={(event) => {
                event.preventDefault();
                startViewTransition(() => navigate(copy.switchHref));
              }}
              className="font-semibold text-[oklch(90%_0.22_129)] no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(90%_0.22_129)]"
            >
              {copy.switchCta}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
