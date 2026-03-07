import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';

export function OnboardingRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { needsOnboarding, onboardingResolved } = useSubscription({
    enabled: !isLoading && isAuthenticated,
  });

  if (isLoading || !onboardingResolved) return null;
  if (!isAuthenticated || !needsOnboarding) return <Redirect to="/" />;

  return <>{children}</>;
}
