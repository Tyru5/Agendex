import { authClient } from '../lib/auth-client.ts';

export function useAuth() {
  const session = authClient.useSession();

  return {
    user: session.data?.user ?? null,
    sessionToken: session.data?.session?.token ?? null,
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.user,
    refreshSession: session.refetch,
    signIn: authClient.signIn,
    signOut: authClient.signOut,
  };
}
