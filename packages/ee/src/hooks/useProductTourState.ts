import { api } from '@convex/_generated/api';
import { type ProductTourState, useLocalProductTourState } from '@agendex/web';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';

export interface UseProductTourStateOptions {
  /**
   * True while the route is still settling the cloud session (initial session
   * fetch, OAuth `ott` callback). The dashboard can already be on screen in
   * local mode at that point; reporting "loading" keeps the tour from starting
   * or recording completion against browser-local state for a user who is
   * about to become signed in.
   */
  authPending?: boolean;
}

/**
 * Tour completion state for the EE shell. Signed-in users persist it on their
 * account (`accountPreferences`), so it follows them across browsers and the
 * desktop app; a local-only session (OSS token without cloud auth) falls back
 * to browser storage.
 */
export function useProductTourState({
  authPending = false,
}: UseProductTourStateOptions = {}): ProductTourState & { reset: () => Promise<void> } {
  const { isAuthenticated, isLoading } = useAuth();
  const authSettling = authPending || isLoading;
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

  const completedVersion = authSettling
    ? undefined
    : isAuthenticated
      ? cloudCompletedVersion
      : local.completedVersion;

  return useMemo(
    () => ({ completedVersion, markCompleted, reset }),
    [completedVersion, markCompleted, reset],
  );
}
