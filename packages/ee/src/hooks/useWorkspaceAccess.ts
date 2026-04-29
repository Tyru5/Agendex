import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useAuth } from './useAuth';

export function useWorkspaceAccess() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const workspace = useQuery(
    api.workspaceAccess.getWorkspaceContext,
    !isAuthLoading && isAuthenticated ? {} : 'skip',
  );

  if (isAuthLoading) {
    return {
      role: 'none' as const,
      canAccessCloud: false,
      isLoading: true,
    };
  }

  if (!isAuthenticated) {
    return {
      role: 'none' as const,
      canAccessCloud: false,
      isLoading: false,
    };
  }

  if (workspace === undefined) {
    return {
      role: 'none' as const,
      canAccessCloud: false,
      isLoading: true,
    };
  }

  return {
    role: workspace.role,
    canAccessCloud: workspace.canAccessCloud,
    isLoading: false,
  };
}
