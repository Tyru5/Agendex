import { DESKTOP_AUTH_CALLBACK_URL } from '@agendex/shared/desktop-auth-callback';

export type DesktopAuthProvider = 'github' | 'google';

export function parseDesktopAuthProvider(value: unknown): DesktopAuthProvider | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'github' || value === 'google') return value;
  return null;
}

export function buildDesktopAuthUrl(
  siteUrl: string,
  state: string,
  provider: DesktopAuthProvider,
): string {
  const authUrl = new URL('/auth/desktop', siteUrl);
  authUrl.searchParams.set('callback', DESKTOP_AUTH_CALLBACK_URL);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('provider', provider);
  return authUrl.toString();
}
