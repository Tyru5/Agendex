import { LandingPage, startViewTransition } from '@agendex/web';
import { useLocation } from 'wouter';
import { EEHeroCta, EENavbarAuth, EEPricingCta } from './LandingAuthSlots.tsx';

export function LandingRoute() {
  const [, navigate] = useLocation();

  return (
    <LandingPage
      mascot={{ onActivate: () => startViewTransition(() => navigate('/about-me')) }}
      onShowChangelog={() => startViewTransition(() => navigate('/changelog'))}
      onShowDocs={() => startViewTransition(() => navigate('/docs'))}
      onShowDownload={() => startViewTransition(() => navigate('/download'))}
      onShowTools={() => startViewTransition(() => navigate('/tools'))}
    >
      <LandingPage.NavbarAuth>{() => <EENavbarAuth />}</LandingPage.NavbarAuth>
      <LandingPage.HeroCta>{() => <EEHeroCta />}</LandingPage.HeroCta>
      <LandingPage.PricingCta>{() => <EEPricingCta />}</LandingPage.PricingCta>
    </LandingPage>
  );
}
