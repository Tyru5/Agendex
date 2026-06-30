import { authClient } from '../lib/auth-client.ts';
import { desktopLogin, desktopLogout, isDesktop } from '../lib/desktop.ts';

export function useAuth() {
  const session = authClient.useSession();

  // In the desktop app, OAuth can't run inside the embedded window (providers
  // block embedded webviews), so sign-in/out is delegated to the system-browser
  // loopback flow handled by the Electron main process.
  const signIn = isDesktop()
    ? ({
        ...authClient.signIn,
        social: (async (..._args: Parameters<typeof authClient.signIn.social>) => {
          const ok = await desktopLogin();
          if (!ok) throw new Error('Sign-in did not finish');
          return { data: null, error: null };
        }) as unknown as typeof authClient.signIn.social,
      } as typeof authClient.signIn)
    : authClient.signIn;

  const signOut = isDesktop()
    ? ((async () => {
        await desktopLogout();
        return { data: null, error: null };
      }) as unknown as typeof authClient.signOut)
    : authClient.signOut;

  return {
    user: session.data?.user ?? null,
    sessionToken: session.data?.session?.token ?? null,
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.user,
    refreshSession: session.refetch,
    signIn,
    signOut,
  };
}
