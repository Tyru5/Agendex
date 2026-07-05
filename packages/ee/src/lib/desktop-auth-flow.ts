import { DESKTOP_AUTH_CALLBACK_URL } from '@agendex/shared/desktop-auth-callback';

export { DESKTOP_AUTH_CALLBACK_URL };

const DESKTOP_AUTH_PROVIDERS = ['github', 'google'] as const;

export type DesktopAuthProvider = (typeof DESKTOP_AUTH_PROVIDERS)[number];

export type DesktopAuthRejectReason = 'bad-url' | 'bad-callback' | 'missing-state' | 'bad-provider';

export type DesktopAuthRequest =
  | {
      readonly ok: true;
      readonly callbackUrl: typeof DESKTOP_AUTH_CALLBACK_URL;
      readonly state: string;
      readonly provider: DesktopAuthProvider;
    }
  | {
      readonly ok: false;
      readonly reason: DesktopAuthRejectReason;
    };

export interface DesktopAuthRedirectInput {
  readonly request: Extract<DesktopAuthRequest, { readonly ok: true }>;
  readonly sessionToken: string;
  readonly convexSiteUrl: string;
}

export function parseDesktopAuthRequest(input: string | URL): DesktopAuthRequest {
  const url = parseUrl(input);
  if (!url) return { ok: false, reason: 'bad-url' };

  const callbackUrl = url.searchParams.get('callback');
  if (callbackUrl !== DESKTOP_AUTH_CALLBACK_URL) return { ok: false, reason: 'bad-callback' };

  const state = url.searchParams.get('state');
  if (!state) return { ok: false, reason: 'missing-state' };

  const provider = url.searchParams.get('provider');
  if (!isDesktopAuthProvider(provider)) return { ok: false, reason: 'bad-provider' };

  return {
    ok: true,
    callbackUrl,
    state,
    provider,
  };
}

export function buildDesktopAuthRedirectUrl(input: DesktopAuthRedirectInput): string {
  const url = new URL(input.request.callbackUrl);
  url.searchParams.set('state', input.request.state);
  url.searchParams.set('provider', input.request.provider);
  url.searchParams.set('token', input.sessionToken);
  url.searchParams.set('convexUrl', input.convexSiteUrl);
  return url.toString();
}

export function redactDesktopAuthUrl(input: string): string {
  const url = parseUrl(input);
  if (!url) return input;
  if (url.searchParams.has('token')) url.searchParams.set('token', '<redacted>');
  return url.toString().replace('token=%3Credacted%3E', 'token=<redacted>');
}

function isDesktopAuthProvider(provider: string | null): provider is DesktopAuthProvider {
  return provider === 'github' || provider === 'google';
}

function parseUrl(input: string | URL): URL | null {
  if (input instanceof URL) return input;
  try {
    return new URL(input);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}
