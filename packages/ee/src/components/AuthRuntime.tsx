import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { ConvexProviderWithAuth } from 'convex/react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { authClient } from '../lib/auth-client.ts';
import { convex } from '../lib/convex-client.ts';
import { getDesktopCloudToken, getDesktopConvexAuthToken, isDesktop } from '../lib/desktop.ts';

/**
 * Convex + Better Auth providers for routes that talk to the cloud backend.
 * Lives in its own module so public marketing pages never download them.
 */
export function AuthRuntime({ children }: { children: ReactNode }) {
  if (isDesktop() && getDesktopCloudToken()) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useDesktopConvexAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }

  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}

function useDesktopConvexAuth() {
  const token = getDesktopCloudToken();
  const cachedTokenRef = useRef<string | null>(null);
  const pendingTokenRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    if (!token) cachedTokenRef.current = null;
  }, [token]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!getDesktopCloudToken()) {
        cachedTokenRef.current = null;
        return null;
      }
      if (cachedTokenRef.current && !forceRefreshToken) return cachedTokenRef.current;
      if (pendingTokenRef.current && !forceRefreshToken) return pendingTokenRef.current;

      if (forceRefreshToken) cachedTokenRef.current = null;

      pendingTokenRef.current = getDesktopConvexAuthToken()
        .then((convexToken) => {
          cachedTokenRef.current = convexToken;
          return convexToken;
        })
        .catch(() => {
          cachedTokenRef.current = null;
          return null;
        })
        .finally(() => {
          pendingTokenRef.current = null;
        });
      return pendingTokenRef.current;
    },
    [],
  );

  return useMemo(
    () => ({
      isLoading: false,
      isAuthenticated: Boolean(token),
      fetchAccessToken,
    }),
    [fetchAccessToken, token],
  );
}
