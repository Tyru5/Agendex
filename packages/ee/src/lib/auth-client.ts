import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import {
  clearDesktopCloudSession,
  desktopBridgeAuthFetch,
  getDesktopBridgeIdentity,
  getDesktopCloudToken,
  getDesktopConvexSiteUrl,
  isDesktop,
  refreshDesktopCloudSession,
  type DesktopAuthFetchInit,
  type DesktopAuthFetchResult,
} from './desktop.ts';

export function normalizeLocalDevUrl(url: string | undefined): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('.local') && !parsed.hostname.endsWith('.localhost')) {
      parsed.hostname = `${parsed.hostname.slice(0, -'.local'.length)}.localhost`;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url.replace(/\/$/, '');
  }
}

export const APP_URL = normalizeLocalDevUrl(
  import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : ''),
);

const desktopConvexSiteUrl = getDesktopConvexSiteUrl();
let refreshedDesktopCloudToken: string | null = null;
let cachedBridgeIdentity = getDesktopBridgeIdentity();

function getEffectiveDesktopCloudToken(): string | null {
  const bridge = getDesktopBridgeIdentity();
  if (bridge !== cachedBridgeIdentity) {
    cachedBridgeIdentity = bridge;
    refreshedDesktopCloudToken = null;
  }
  return refreshedDesktopCloudToken ?? getDesktopCloudToken();
}

async function serializeDesktopAuthRequest(request: Request): Promise<DesktopAuthFetchInit> {
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text();
  return {
    method: request.method,
    headers: Array.from(request.headers.entries()),
    body: body && body.length > 0 ? body : null,
  };
}

function createResponseFromDesktopAuthFetch(result: DesktopAuthFetchResult): Response {
  const headers = new Headers();
  for (const [name, value] of result.headers) {
    headers.append(name, value);
  }
  return new Response(result.body, {
    headers,
    status: result.status,
    statusText: result.statusText,
  });
}

function createRequestFromDesktopAuthFetchInit(url: string, init: DesktopAuthFetchInit): Request {
  const headers = new Headers();
  for (const [name, value] of init.headers) {
    headers.append(name, value);
  }
  return new Request(url, {
    body: init.body ?? undefined,
    headers,
    method: init.method,
  });
}

async function fetchViaDesktopBridge(request: Request): Promise<Response> {
  if (!getDesktopCloudToken() || !getDesktopConvexSiteUrl()) return fetch(request);
  const init = await serializeDesktopAuthRequest(request);
  const result = await desktopBridgeAuthFetch(request.url, init);
  return result
    ? createResponseFromDesktopAuthFetch(result)
    : fetch(createRequestFromDesktopAuthFetchInit(request.url, init));
}

/**
 * Desktop auth fetch: attach the cloud Bearer token and, on 401, try a one-shot
 * session refresh. Only reload when we *had* a stored cloud session that the
 * main process then cleared — reloading re-bootstraps the preload without a
 * stale token and lands on the sign-in gate.
 *
 * Critical: unsigned-in desktop still mounts ConvexBetterAuthProvider, which
 * probes `/api/auth/get-session`. That returns 401 with no cloud token. If we
 * reloaded on every bare 401 the window would spin forever on a blank themed
 * background (prod desktop blank-screen bug).
 *
 * Bodies are carried via a `Request` that is cloned for the first attempt so a
 * retry after refresh can re-send POST bodies (streams are one-shot).
 */
export async function desktopAuthFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getEffectiveDesktopCloudToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // Materialize a Request up front so we can clone it before the first fetch
  // consumes any body stream, then rebuild with a rotated Authorization header.
  const request = new Request(input, { ...init, headers });
  let response = await fetchViaDesktopBridge(request.clone());
  if (response.status !== 401) return response;

  // No stored cloud session → ordinary unauthenticated response. Do not refresh
  // or reload; the sign-in gate handles this state.
  if (!token) return response;

  const refreshedToken = await refreshDesktopCloudSession();
  if (!refreshedToken) {
    refreshedDesktopCloudToken = null;
    // Drop main-process + bridge creds before reload so the next boot cannot
    // re-expose the same revoked token and re-enter this 401→reload loop.
    await clearDesktopCloudSession();
    if (typeof window !== 'undefined') window.location.reload();
    return response;
  }
  refreshedDesktopCloudToken = refreshedToken;

  const retryHeaders = new Headers(request.headers);
  retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
  response = await fetchViaDesktopBridge(new Request(request, { headers: retryHeaders }));
  return response;
}

// The Convex site origin auth requests actually go to: the desktop bridge's
// runtime URL when present, the baked Vite env otherwise. Callback flows that
// echo a `convexUrl` back to the desktop main process must use this same
// value, or the session token and origin can disagree.
export const AUTH_BASE_URL =
  desktopConvexSiteUrl || ((import.meta.env.VITE_CONVEX_SITE_URL as string) ?? '');

export function isSameOriginAuth(authBaseUrl: string, currentOrigin: string | undefined): boolean {
  if (!currentOrigin) return false;
  try {
    return new URL(authBaseUrl, currentOrigin).origin === currentOrigin;
  } catch {
    return false;
  }
}

const sameOriginAuth =
  isSameOriginAuth(
    AUTH_BASE_URL,
    typeof window !== 'undefined' ? window.location.origin : undefined,
  ) && import.meta.env.VITE_AUTH_USE_NATIVE_CREDENTIALS === 'true';

export function sameOriginAuthFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' });
}

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  // The cross-domain plugin deliberately omits browser credentials and carries
  // Better Auth cookies through localStorage instead. Keep the plugin because
  // Convex uses its local updateSession action. Orb services explicitly restore
  // native credentials so Amp's portal cookie reaches the same-origin proxy.
  plugins: [convexClient(), crossDomainClient({ disableCache: true })],
  // `customFetchImpl` (not a top-level `fetch` key) is how better-auth accepts
  // a fetch override; it routes every auth request (get-session, list-accounts,
  // ...) through the Bearer-token wrapper so desktop sessions resolve a user.
  ...(isDesktop()
    ? { fetchOptions: { customFetchImpl: desktopAuthFetch } }
    : sameOriginAuth
      ? { fetchOptions: { customFetchImpl: sameOriginAuthFetch } }
      : {}),
});
