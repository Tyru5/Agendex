import type { ReactNode } from 'react';
import { SkeletonBlock } from '@agendex/web';
import { Redirect } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';

export function OnboardingRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { needsOnboarding, onboardingResolved } = useSubscription({
    enabled: !isLoading && isAuthenticated,
  });

  if (isLoading || !onboardingResolved)
    return (
      <div className="h-screen flex items-center justify-center bg-bg">
        <div className="w-full max-w-[420px] px-5">
          <div className="text-[13px] text-tertiary mb-3 text-center">Loading...</div>
          <SkeletonBlock lines={4} />
        </div>
      </div>
    );
  if (!isAuthenticated || !needsOnboarding) return <Redirect to="/" />;

  return <>{children}</>;
}
