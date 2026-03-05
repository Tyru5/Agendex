import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';

export function OnboardingRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { needsOnboarding, onboardingLoading } = useSubscription();

  if (isLoading || onboardingLoading) return null;
  if (!isAuthenticated || !needsOnboarding) return <Redirect to="/" />;

  return <>{children}</>;
}
