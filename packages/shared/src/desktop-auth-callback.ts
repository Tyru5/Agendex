import { normalizeConvexSiteUrl } from './convex-url.ts';

const DESKTOP_AUTH_CALLBACK_PROTOCOL = 'agendex:';
const DESKTOP_AUTH_CALLBACK_HOST = 'auth';
const DESKTOP_AUTH_CALLBACK_PATH = '/callback';
const REDACTED_VALUE = '<redacted>';

export const DESKTOP_AUTH_CALLBACK_URL = 'agendex://auth/callback';

export type DesktopAuthCallbackInput = {
  readonly token: string;
  readonly state: string;
  readonly convexUrl: string;
};

export type DesktopAuthCallback = {
  readonly token: string;
  readonly state: string;
  readonly convexUrl: string;
};

export type DesktopAuthStateExpectation = {
  readonly state: string;
  readonly expiresAtMs?: number;
  readonly nowMs?: number;
};

export type DesktopAuthCallbackError =
  | { readonly code: 'invalid-url' }
  | { readonly code: 'wrong-callback-target' }
  | { readonly code: 'missing-token' }
  | { readonly code: 'missing-state' }
  | {
      readonly code: 'state-mismatch';
      readonly expectedState: string;
      readonly receivedState: string;
    }
  | { readonly code: 'state-expired' }
  | { readonly code: 'missing-convex-url' }
  | { readonly code: 'untrusted-convex-url' };

export type DesktopAuthCallbackParseResult =
  | { readonly ok: true; readonly value: DesktopAuthCallback }
  | { readonly ok: false; readonly error: DesktopAuthCallbackError };

export type DesktopAuthStateValidationResult =
  | { readonly ok: true; readonly value: { readonly state: string } }
  | {
      readonly ok: false;
      readonly error: Extract<
        DesktopAuthCallbackError,
        { readonly code: 'missing-state' | 'state-mismatch' | 'state-expired' }
      >;
    };

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
}

function isDesktopAuthCallbackTarget(url: URL): boolean {
  return (
    url.protocol === DESKTOP_AUTH_CALLBACK_PROTOCOL &&
    url.hostname === DESKTOP_AUTH_CALLBACK_HOST &&
    url.pathname === DESKTOP_AUTH_CALLBACK_PATH
  );
}

function readRequiredQueryParam(searchParams: URLSearchParams, key: string): string | null {
  const value = searchParams.get(key);
  if (!value || value.trim().length === 0) return null;
  return value;
}

export function createDesktopAuthCallbackUrl(input: DesktopAuthCallbackInput): string | null {
  const token = input.token.trim().length > 0 ? input.token : null;
  const state = input.state.trim().length > 0 ? input.state : null;
  const convexUrl = normalizeConvexSiteUrl(input.convexUrl);
  if (!token || !state || !convexUrl) return null;

  const url = new URL(DESKTOP_AUTH_CALLBACK_URL);
  url.searchParams.set('token', token);
  url.searchParams.set('state', state);
  url.searchParams.set('convexUrl', convexUrl);
  return url.toString();
}

export function validateDesktopAuthCallbackState(
  receivedState: string | null,
  expectation: DesktopAuthStateExpectation,
): DesktopAuthStateValidationResult {
  if (!receivedState || receivedState.trim().length === 0) {
    return { ok: false, error: { code: 'missing-state' } };
  }

  if (receivedState !== expectation.state) {
    return {
      ok: false,
      error: {
        code: 'state-mismatch',
        expectedState: expectation.state,
        receivedState,
      },
    };
  }

  if (
    typeof expectation.expiresAtMs === 'number' &&
    (expectation.nowMs ?? Date.now()) >= expectation.expiresAtMs
  ) {
    return { ok: false, error: { code: 'state-expired' } };
  }

  return { ok: true, value: { state: receivedState } };
}

export function parseDesktopAuthCallbackUrl(
  value: string,
  expectation: DesktopAuthStateExpectation,
): DesktopAuthCallbackParseResult {
  const url = parseUrl(value);
  if (!url) return { ok: false, error: { code: 'invalid-url' } };
  if (!isDesktopAuthCallbackTarget(url)) {
    return { ok: false, error: { code: 'wrong-callback-target' } };
  }

  const token = readRequiredQueryParam(url.searchParams, 'token');
  if (!token) return { ok: false, error: { code: 'missing-token' } };

  const stateValidation = validateDesktopAuthCallbackState(
    readRequiredQueryParam(url.searchParams, 'state'),
    expectation,
  );
  if (!stateValidation.ok) return stateValidation;

  const convexParam = readRequiredQueryParam(url.searchParams, 'convexUrl');
  if (!convexParam) return { ok: false, error: { code: 'missing-convex-url' } };

  const convexUrl = normalizeConvexSiteUrl(convexParam);
  if (!convexUrl) return { ok: false, error: { code: 'untrusted-convex-url' } };

  return {
    ok: true,
    value: {
      token,
      state: stateValidation.value.state,
      convexUrl,
    },
  };
}

function redactQueryLikeText(value: string): string {
  return value.replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, `$1=${REDACTED_VALUE}`);
}

export function redactDesktopAuthCallbackUrl(value: string): string {
  const url = parseUrl(value);
  if (!url) return redactQueryLikeText(value);

  const keys = [...url.searchParams.keys()];
  for (const key of keys) {
    url.searchParams.set(key, REDACTED_VALUE);
  }
  if (url.hash) url.hash = REDACTED_VALUE;
  return url.toString();
}
