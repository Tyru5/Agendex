import { authClient } from '../lib/auth-client.ts';
import { useEffect, useRef } from 'react';
import {
  desktopLogin,
  desktopLogout,
  getDesktopCloudToken,
  isDesktop,
  normalizeDesktopAuthProvider,
} from '../lib/desktop.ts';
import { lockAllWorkspaceKeys } from '../lib/obfuscation-keyring.ts';

export function useAuth() {
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? null;
  const previousUserId = useRef<string | null>(userId);
  useEffect(() => {
    if (previousUserId.current && previousUserId.current !== userId) {
      lockAllWorkspaceKeys();
    }
    previousUserId.current = userId;
  }, [userId]);
  const desktop = isDesktop();
  const desktopCloudToken = desktop ? getDesktopCloudToken() : null;
  const desktopHasCloudSession = Boolean(desktopCloudToken);

  // In the desktop app, OAuth can't run inside the embedded window (providers
  // block embedded webviews), so sign-in/out is delegated to the system-browser
  // loopback flow handled by the Electron main process.
  const signIn = desktop
    ? ({
        ...authClient.signIn,
        social: (async (...args: Parameters<typeof authClient.signIn.social>) => {
          const provider = normalizeDesktopAuthProvider(args[0]?.provider);
          const ok = await desktopLogin(provider);
          if (!ok) throw new Error('Sign-in did not finish');
          return { data: null, error: null };
        }) as unknown as typeof authClient.signIn.social,
      } as typeof authClient.signIn)
    : authClient.signIn;

  const platformSignOut = desktop
    ? ((async () => {
        await desktopLogout();
        return { data: null, error: null };
      }) as unknown as typeof authClient.signOut)
    : authClient.signOut;
  const signOut = (async (...args: Parameters<typeof authClient.signOut>) => {
    lockAllWorkspaceKeys();
    return platformSignOut(...args);
  }) as typeof authClient.signOut;

  return {
    user: session.data?.user ?? null,
    sessionToken: desktopCloudToken ?? session.data?.session?.token ?? null,
    // Desktop resolves `user` through the same session fetch (sent with the
    // cloud Bearer token), so loading must track it there too — otherwise
    // routes like /settings see `isAuthenticated && !user` while the fetch is
    // still in flight and bounce the user away.
    isLoading: session.isPending,
    // Contract: on desktop, `isAuthenticated` reflects the stored cloud
    // session, while `user` can stay null if the profile fetch fails (or the
    // session was revoked). Consumers that need the profile must handle a
    // null `user` once `isLoading` settles instead of assuming it from
    // `isAuthenticated`.
    isAuthenticated: desktopHasCloudSession || !!session.data?.user,
    refreshSession: session.refetch,
    signIn,
    signOut,
  };
}
