import type { AuthProvider } from './auth-providers.ts';

export function isEmbeddedBrowser(currentWindow: object, topWindow: object | null): boolean {
  return currentWindow !== topWindow;
}

export function shouldOpenAuthExternally(
  currentWindow: object,
  topWindow: object | null,
  forceExternal: boolean,
): boolean {
  return forceExternal || isEmbeddedBrowser(currentWindow, topWindow);
}

export function requestedAuthProvider(search: string): AuthProvider | null {
  const provider = new URLSearchParams(search).get('oauth');
  return provider === 'github' || provider === 'google' ? provider : null;
}

export function externalAuthUrl(appUrl: string, provider: AuthProvider): string {
  const url = new URL('/login', appUrl);
  url.searchParams.set('oauth', provider);
  return url.toString();
}
