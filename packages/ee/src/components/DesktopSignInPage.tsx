import { GitHubIcon, GoogleIcon } from '@agendex/web';
import { useState } from 'react';
import { desktopLogin } from '../lib/desktop.ts';

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="desktop-signin-spinner shrink-0 motion-safe:animate-spin"
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

type Provider = 'github' | 'google';

/**
 * Sign-in gate for the desktop app. Without a valid cloud session we render this
 * instead of the dashboard, so no agent/plan info is shown until the user
 * authenticates. On successful provider auth the bridge reloads the window,
 * which re-enters DashboardRoute with the now-stored cloud session.
 *
 * Styled with the shared design tokens (not hard-coded colors) so the gate
 * tracks the user's light/dark theme like the rest of the product.
 */
export function DesktopSignInPage() {
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn(provider: Provider) {
    if (busyProvider) return;
    setBusyProvider(provider);
    setError(null);
    try {
      const ok = await desktopLogin(provider);
      if (ok) return;
      setBusyProvider(null);
      setError('Sign-in did not finish. Try again.');
    } catch {
      setBusyProvider(null);
      setError('Could not open the sign-in flow. Try again.');
    }
  }

  return (
    <main
      className="desktop-signin-shell relative grid min-h-screen place-items-center overflow-hidden bg-bg px-6 py-12 text-text"
      aria-labelledby="desktop-signin-title"
    >
      <section className="desktop-signin-content flex w-full max-w-[340px] flex-col items-center text-center">
        <img
          src="/favicon.png"
          alt="Agendex"
          width={48}
          height={48}
          draggable={false}
          className="mb-6 h-12 w-12 rounded-[12px]"
        />
        <h1
          id="desktop-signin-title"
          className="m-0 text-balance text-[20px] font-[650] leading-[1.2] text-text"
        >
          Sign in to Agendex
        </h1>
        <p className="mx-auto mt-3 mb-8 max-w-[34ch] text-pretty text-[13.5px] leading-[1.55] text-secondary">
          Connect your account to open cloud plans and agent activity. Sign-in opens in your system
          browser.
        </p>

        <div className="flex w-full flex-col gap-2.5">
          <button
            type="button"
            disabled={busyProvider !== null}
            aria-busy={busyProvider === 'github'}
            onClick={() => handleSignIn('github')}
            className="desktop-signin-cta flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-default border border-border bg-surface px-4 py-3 text-[13.5px] font-semibold text-text transition-colors duration-150 hover:bg-hover disabled:cursor-default disabled:opacity-50"
          >
            {busyProvider === 'github' ? <Spinner size={16} /> : <GitHubIcon size={16} />}
            {busyProvider === 'github' ? 'Waiting…' : 'Continue with GitHub'}
          </button>
          <button
            type="button"
            disabled={busyProvider !== null}
            aria-busy={busyProvider === 'google'}
            onClick={() => handleSignIn('google')}
            className="desktop-signin-cta flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-default border border-border bg-surface px-4 py-3 text-[13.5px] font-semibold text-text transition-colors duration-150 hover:bg-hover disabled:cursor-default disabled:opacity-50"
          >
            {busyProvider === 'google' ? <Spinner size={16} /> : <GoogleIcon size={16} />}
            {busyProvider === 'google' ? 'Waiting…' : 'Continue with Google'}
          </button>
        </div>

        {error ? (
          <p role="alert" className="desktop-signin-error mt-4 mb-0">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
