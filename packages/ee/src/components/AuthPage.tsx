import { GitHubIcon, GoogleIcon, startViewTransition } from '@agendex/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth.ts';
import { APP_URL } from '../lib/auth-client.ts';
import {
  externalAuthUrl,
  isEmbeddedBrowser,
  requestedAuthProvider,
  shouldOpenAuthExternally,
} from '../lib/auth-navigation.ts';
import { AUTH_PROVIDERS, type AuthProvider } from '../lib/auth-providers.ts';

const DASHBOARD_PATH = '/dashboard';

type AuthMode = 'login' | 'signup';

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 animate-spin"
      style={{ animationDuration: '0.8s' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity={0.25} />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M4 2.5 7.5 6 4 9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/*
 * Auth lives inside the Column View world: the page is the marketing ground
 * (`.landing-page` tokens), and the sign-in choices are rows of one listing.
 */
const ROW_CLASS =
  'landing-row min-h-[44px] w-full cursor-pointer border-b border-[var(--landing-border-subtle)] bg-transparent text-left text-[13.5px] font-semibold text-[var(--landing-text)] no-underline transition-colors duration-150 last:border-b-0 hover:bg-[var(--landing-surface-raised)] disabled:cursor-default disabled:opacity-60';

function AuthProviderButton({
  provider,
  activeProvider,
  externalHref,
  onClick,
}: {
  provider: AuthProvider;
  activeProvider: AuthProvider | null;
  externalHref?: string;
  onClick: (provider: AuthProvider) => void;
}) {
  const isActive = activeProvider === provider;
  const isDisabled = activeProvider !== null;
  const label = provider === 'github' ? 'Continue with GitHub' : 'Continue with Google';
  const Icon = provider === 'github' ? GitHubIcon : GoogleIcon;
  const content = (
    <>
      <span className="flex size-[18px] items-center justify-center text-[var(--landing-text)]">
        {isActive ? <Spinner size={15} /> : <Icon size={16} />}
      </span>
      <span className="landing-row-name">{isActive ? 'Redirecting…' : label}</span>
      <span className="text-[var(--landing-faint)]">
        <ChevronIcon />
      </span>
    </>
  );

  if (externalHref) {
    return (
      <a href={externalHref} target="_blank" rel="noopener noreferrer" className={ROW_CLASS}>
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => onClick(provider)}
      className={ROW_CLASS}
    >
      {content}
    </button>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="landing-page landing-subpage flex min-h-[100dvh] flex-col">
      <div className="landing-toolbar">
        <a href="/" className="landing-toolbar-brand">
          Agendex<em>.</em>
        </a>
      </div>
      <div className="grid flex-1 place-items-center px-4 py-10">{children}</div>
    </main>
  );
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { isAuthenticated, isLoading, signIn } = useAuth();
  const [, navigate] = useLocation();
  const didRedirectRef = useRef(false);
  const didStartRequestedProviderRef = useRef(false);
  const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const embedded = isEmbeddedBrowser(window.self, window.top);
  const requestedProvider = requestedAuthProvider(window.location.search);
  const openAuthExternally = shouldOpenAuthExternally(
    window.self,
    window.top,
    import.meta.env.VITE_AUTH_OPEN_EXTERNALLY === 'true' && !requestedProvider,
  );

  const copy = useMemo(
    () =>
      mode === 'signup'
        ? {
            head: 'Create account',
            title: 'Start with Agendex.',
            body:
              AUTH_PROVIDERS.length === 1
                ? `Use ${AUTH_PROVIDERS[0] === 'github' ? 'GitHub' : 'Google'}. No password to set up.`
                : 'Use GitHub or Google. No password to set up.',
            switchLabel: 'Already have access?',
            switchCta: 'Sign in',
            switchHref: '/login',
          }
        : {
            head: 'Sign in',
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

  const handleProvider = useCallback(
    async (provider: AuthProvider) => {
      setActiveProvider(provider);
      setError(null);
      try {
        const result = await signIn.social({
          provider,
          callbackURL: `${APP_URL}${DASHBOARD_PATH}`,
        });
        if (result.error) {
          setActiveProvider(null);
          setError(result.error.message || 'Could not start OAuth. Try again in a moment.');
        }
      } catch {
        setActiveProvider(null);
        setError('Could not start OAuth. Try again in a moment.');
      }
    },
    [signIn],
  );

  useEffect(() => {
    if (
      embedded ||
      !requestedProvider ||
      isLoading ||
      isAuthenticated ||
      didStartRequestedProviderRef.current
    ) {
      return;
    }

    didStartRequestedProviderRef.current = true;
    void handleProvider(requestedProvider);
  }, [embedded, handleProvider, isAuthenticated, isLoading, requestedProvider]);

  if (isAuthenticated || isLoading) {
    return (
      <AuthShell>
        <div
          className="landing-list flex items-center gap-3 px-4 py-3 text-[13.5px] text-[var(--landing-muted)]"
          aria-busy="true"
          role="status"
        >
          <Spinner size={16} />
          Checking your session…
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <section className="w-full max-w-[420px]">
        <h1 className="landing-h2 text-[clamp(28px,3.4vw,36px)]">{copy.title}</h1>
        <p className="landing-lede mt-3 text-[14px]">{copy.body}</p>

        <div className="landing-list mt-6" aria-busy={activeProvider !== null || isLoading}>
          <div className="landing-list-head">
            {copy.head}
            <span>
              {AUTH_PROVIDERS.length} {AUTH_PROVIDERS.length === 1 ? 'option' : 'options'}
            </span>
          </div>
          {AUTH_PROVIDERS.map((provider) => (
            <AuthProviderButton
              key={provider}
              provider={provider}
              activeProvider={activeProvider}
              externalHref={openAuthExternally ? externalAuthUrl(APP_URL, provider) : undefined}
              onClick={handleProvider}
            />
          ))}
        </div>

        {error && (
          <p
            className="mt-3 mb-0 text-[12.5px] font-semibold leading-[1.5] text-[var(--landing-error)]"
            role="alert"
          >
            {error}
          </p>
        )}

        <p className="mt-5 mb-0 text-[13px] text-[var(--landing-muted)]">
          {copy.switchLabel}{' '}
          <Link
            href={copy.switchHref}
            onClick={(event) => {
              event.preventDefault();
              startViewTransition(() => navigate(copy.switchHref));
            }}
            className="font-semibold text-[var(--landing-accent)] underline decoration-[color-mix(in_oklch,var(--landing-accent)_40%,transparent)] underline-offset-[3px] hover:decoration-[var(--landing-accent)]"
          >
            {copy.switchCta}
          </Link>
        </p>
        <p className="mt-2 mb-0 text-[12px] leading-[1.55] text-[var(--landing-faint)]">
          By continuing, you agree to our{' '}
          <a
            href="/terms"
            className="font-semibold text-[var(--landing-muted)] underline decoration-[var(--landing-border-strong)] underline-offset-[3px] hover:text-[var(--landing-text)]"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            href="/privacy"
            className="font-semibold text-[var(--landing-muted)] underline decoration-[var(--landing-border-strong)] underline-offset-[3px] hover:text-[var(--landing-text)]"
          >
            Privacy Policy
          </a>
          .
        </p>
      </section>
    </AuthShell>
  );
}
