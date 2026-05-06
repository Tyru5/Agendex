import { useEffect, useRef, useState } from 'react';
import { GitHubIcon, GoogleIcon, useLandingContext } from '@agendex/web';

function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin shrink-0"
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

export function EENavbarAuth({ onLogin }: { onLogin: (provider: 'github' | 'google') => void }) {
  const { signingIn, startSigningIn, stopSigningIn } = useLandingContext();
  const [showProviders, setShowProviders] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showProviders) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowProviders(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProviders]);

  async function handleLogin(provider: 'github' | 'google') {
    setShowProviders(false);
    startSigningIn();
    try {
      await onLogin(provider);
    } catch {
      stopSigningIn();
    }
  }

  return (
    <div className="relative w-full md:w-auto" ref={ref}>
      <button
        type="button"
        disabled={signingIn}
        onClick={() => setShowProviders(!showProviders)}
        className="w-full md:w-auto text-[13px] px-5 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-transparent text-white font-medium font-[Inter,-apple-system,system-ui,sans-serif] transition-[border-color] duration-200 inline-flex items-center justify-center gap-1.5"
        style={{
          cursor: signingIn ? 'default' : 'pointer',
          opacity: signingIn ? 0.6 : 1,
        }}
      >
        {signingIn && <Spinner size={12} />}
        {signingIn ? 'Redirecting\u2026' : 'Sign in'}
      </button>
      {showProviders && (
        <div
          className="absolute left-0 right-0 top-full mt-2 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden min-w-[200px] md:left-auto md:right-0 md:w-[220px]"
          style={{ animation: 'statusPopoverIn 120ms ease-out' }}
        >
          <button
            type="button"
            onClick={() => handleLogin('github')}
            className="w-full px-4 py-3 border-none bg-transparent text-[13px] text-white text-left cursor-pointer flex items-center gap-2.5 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)]"
          >
            <GitHubIcon /> Continue with GitHub
          </button>
          <button
            type="button"
            onClick={() => handleLogin('google')}
            className="w-full px-4 py-3 border-none bg-transparent text-[13px] text-white text-left cursor-pointer flex items-center gap-2.5 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)]"
          >
            <GoogleIcon /> Continue with Google
          </button>
        </div>
      )}
    </div>
  );
}

export function EEHeroCta({ onLogin }: { onLogin: (provider: 'github' | 'google') => void }) {
  const { signingIn, activeTab, showLogin, startSigningIn, stopSigningIn } = useLandingContext();

  async function handleLogin(provider: 'github' | 'google') {
    startSigningIn();
    try {
      await onLogin(provider);
    } catch {
      stopSigningIn();
    }
  }

  if (activeTab === 'cloud') {
    if (signingIn) {
      return (
        <button
          type="button"
          disabled
          className="w-full sm:w-auto px-7 py-3 rounded-xl border-none bg-[#c8ff32] text-[#0a0a0a] text-[15px] font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap opacity-70"
        >
          <Spinner size={16} color="#0a0a0a" />
          Redirecting…
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={() => handleLogin('github')}
          className="w-full sm:w-auto px-7 py-3 rounded-xl border-none bg-[#c8ff32] text-[#0a0a0a] text-[15px] font-semibold cursor-pointer transition-[opacity,transform] duration-200 inline-flex items-center justify-center gap-2 whitespace-nowrap"
        >
          <GitHubIcon /> GitHub
        </button>
        <button
          type="button"
          onClick={() => handleLogin('google')}
          className="w-full sm:w-auto px-7 py-3 rounded-xl border border-[rgba(238,244,232,0.16)] bg-[color-mix(in_oklch,#eef4e8_8%,#041f1d)] text-[#eef4e8] text-[15px] font-semibold cursor-pointer transition-[background-color,border-color,opacity,transform] duration-200 inline-flex items-center justify-center gap-2 whitespace-nowrap hover:border-[rgba(238,244,232,0.24)] hover:bg-[color-mix(in_oklch,#eef4e8_12%,#041f1d)]"
        >
          <GoogleIcon /> Google
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={showLogin}
      className="w-full sm:w-auto px-7 py-3 rounded-xl border-none bg-[#c8ff32] text-[#0a0a0a] text-[15px] font-semibold cursor-pointer transition-[opacity,transform] duration-200 inline-flex items-center justify-center gap-2 whitespace-nowrap"
    >
      Get Started
    </button>
  );
}

export function EEPricingCta({ onLogin }: { onLogin: (provider: 'github' | 'google') => void }) {
  const { signingIn, startSigningIn, stopSigningIn } = useLandingContext();

  async function handleLogin(provider: 'github' | 'google') {
    startSigningIn();
    try {
      await onLogin(provider);
    } catch {
      stopSigningIn();
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row">
      <button
        type="button"
        disabled={signingIn}
        onClick={() => handleLogin('github')}
        className="flex-1 py-3.5 rounded-xl border border-[color-mix(in_oklch,#c8ff32_28%,rgba(238,244,232,0.12))] bg-[color-mix(in_oklch,#c8ff32_11%,#041f1d)] text-[#eef4e8] text-[14px] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-opacity duration-200"
        style={{
          opacity: signingIn ? 0.7 : 1,
          cursor: signingIn ? 'default' : 'pointer',
        }}
      >
        <GitHubIcon /> GitHub
      </button>
      <button
        type="button"
        disabled={signingIn}
        onClick={() => handleLogin('google')}
        className="flex-1 py-3.5 rounded-xl border border-[rgba(238,244,232,0.16)] bg-[color-mix(in_oklch,#eef4e8_8%,#041f1d)] text-[#eef4e8] text-[14px] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-[background-color,border-color,opacity] duration-200 hover:border-[rgba(238,244,232,0.24)] hover:bg-[color-mix(in_oklch,#eef4e8_12%,#041f1d)]"
        style={{
          opacity: signingIn ? 0.7 : 1,
          cursor: signingIn ? 'default' : 'pointer',
        }}
      >
        <GoogleIcon /> Google
      </button>
    </div>
  );
}
