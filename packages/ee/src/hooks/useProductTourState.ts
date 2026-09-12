import { api } from '@convex/_generated/api';
import { type ProductTourState, useLocalProductTourState } from '@agendex/web';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';

/**
 * Tour completion state for the EE shell. Signed-in users persist it on their
 * account (`accountPreferences`), so it follows them across browsers and the
 * desktop app; a local-only session (OSS token without cloud auth) falls back
 * to browser storage.
 */
export function useProductTourState(): ProductTourState & { reset: () => Promise<void> } {
  const { isAuthenticated } = useAuth();
  const cloudCompletedVersion = useQuery(
    api.account.getMyProductTourCompletedVersion,
    isAuthenticated ? {} : 'skip',
  );
  const updateCloud = useMutation(api.account.updateProductTourCompletedVersion);
  const local = useLocalProductTourState();

  const markCompleted = useCallback(
    async (version: number) => {
      if (!isAuthenticated) {
        local.markCompleted(version);
        return;
      }
      await updateCloud({ completedVersion: version });
    },
    [isAuthenticated, local, updateCloud],
  );

  const reset = useCallback(async () => {
    if (!isAuthenticated) {
      local.reset();
      return;
    }
    await updateCloud({ completedVersion: null });
  }, [isAuthenticated, local, updateCloud]);

  return useMemo(
    () => ({
      completedVersion: isAuthenticated ? cloudCompletedVersion : local.completedVersion,
      markCompleted,
      reset,
    }),
    [cloudCompletedVersion, isAuthenticated, local.completedVersion, markCompleted, reset],
  );
}
