import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useAuth } from './useAuth';
import { useSubscription } from './useSubscription';

export function useWorkspaceAccess() {
  const { isAuthenticated } = useAuth();
  const { isActive } = useSubscription({ enabled: isAuthenticated });

  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const membership = useQuery(
    // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
    (api as any).workspaceMembers.getMyMembership,
    isAuthenticated && !isActive ? {} : 'skip',
  );

  if (isActive) {
    return {
      role: 'owner' as const,
      canAccessCloud: true,
      isLoading: false,
    };
  }

  if (!isAuthenticated) {
    return {
      role: 'none' as const,
      canAccessCloud: false,
      isLoading: false,
    };
  }

  if (membership === undefined) {
    return {
      role: 'none' as const,
      canAccessCloud: false,
      isLoading: true,
    };
  }

  if (membership) {
    return {
      role: 'member' as const,
      canAccessCloud: true,
      isLoading: false,
    };
  }

  return {
    role: 'none' as const,
    canAccessCloud: false,
    isLoading: false,
  };
}
