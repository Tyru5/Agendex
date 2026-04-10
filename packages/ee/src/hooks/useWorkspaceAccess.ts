import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useAuth } from './useAuth';

export function useWorkspaceAccess() {
  const { isAuthenticated } = useAuth();

  const workspace = useQuery(
    api.workspaceAccess.getWorkspaceContext,
    isAuthenticated ? {} : 'skip',
  );

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
