import { useLandingContext } from '@agendex/web';
import { useLocation } from 'wouter';

export function EENavbarAuth({
  onLogin: _onLogin,
}: {
  onLogin: (provider: 'github' | 'google') => void;
}) {
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      onClick={() => navigate('/login')}
      className="w-full md:w-auto text-[13px] px-5 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-transparent text-white font-medium font-[Inter,-apple-system,system-ui,sans-serif] transition-[border-color] duration-200 inline-flex items-center justify-center gap-1.5 hover:border-[rgba(238,244,232,0.18)]"
    >
      Sign in
    </button>
  );
}

export function EEHeroCta({
  onLogin: _onLogin,
}: {
  onLogin: (provider: 'github' | 'google') => void;
}) {
  const { activeTab, showLogin } = useLandingContext();
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      onClick={activeTab === 'cloud' ? () => navigate('/signup') : showLogin}
      className="w-full sm:w-auto px-7 py-3 rounded-xl border-none bg-[#c8ff32] text-[#0a0a0a] text-[15px] font-semibold cursor-pointer transition-[opacity,transform] duration-200 inline-flex items-center justify-center gap-2 whitespace-nowrap"
    >
      {activeTab === 'cloud' ? 'Sign up' : 'Get Started'}
    </button>
  );
}

export function EEPricingCta({
  onLogin: _onLogin,
}: {
  onLogin: (provider: 'github' | 'google') => void;
}) {
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      onClick={() => navigate('/signup')}
      className="w-full py-3.5 rounded-xl border border-[color-mix(in_oklch,#c8ff32_28%,rgba(238,244,232,0.12))] bg-[color-mix(in_oklch,#c8ff32_11%,#041f1d)] text-[#eef4e8] text-[14px] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-[background-color,border-color] duration-200 hover:border-[color-mix(in_oklch,#c8ff32_40%,rgba(238,244,232,0.12))]"
    >
      Sign up for Cloud
    </button>
  );
}
