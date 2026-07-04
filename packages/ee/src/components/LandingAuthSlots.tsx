import { startViewTransition, useLandingContext } from '@agendex/web';
import { useLocation } from 'wouter';

export function EENavbarAuth() {
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      onClick={() => startViewTransition(() => navigate('/login'))}
      className="landing-action landing-action--secondary landing-action--compact"
    >
      Sign in
    </button>
  );
}

export function EEHeroCta() {
  const { activeTab, showLogin } = useLandingContext();
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      onClick={
        activeTab === 'cloud' ? () => startViewTransition(() => navigate('/signup')) : showLogin
      }
      className="landing-action landing-action--primary"
    >
      {activeTab === 'cloud' ? 'Sign up' : 'Get Started'}
      <span aria-hidden="true">→</span>
    </button>
  );
}

export function EEPricingCta() {
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      onClick={() => startViewTransition(() => navigate('/signup'))}
      className="landing-action landing-action--primary landing-action--full"
    >
      Sign up for Cloud
    </button>
  );
}
