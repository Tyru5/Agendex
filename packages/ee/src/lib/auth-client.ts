import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import {
  clearDesktopCloudSession,
  getDesktopCloudToken,
  getDesktopConvexSiteUrl,
  isDesktop,
  refreshDesktopCloudSession,
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
  const token = getDesktopCloudToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // Materialize a Request up front so we can clone it before the first fetch
  // consumes any body stream, then rebuild with a rotated Authorization header.
  const request = new Request(input, { ...init, headers });
  let response = await fetch(request.clone());
  if (response.status !== 401) return response;

  // No stored cloud session → ordinary unauthenticated response. Do not refresh
  // or reload; the sign-in gate handles this state.
  if (!token) return response;

  const refreshedToken = await refreshDesktopCloudSession();
  if (!refreshedToken) {
    // Drop main-process + bridge creds before reload so the next boot cannot
    // re-expose the same revoked token and re-enter this 401→reload loop.
    await clearDesktopCloudSession();
    if (typeof window !== 'undefined') window.location.reload();
    return response;
  }

  const retryHeaders = new Headers(request.headers);
  retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
  response = await fetch(new Request(request, { headers: retryHeaders }));
  return response;
}

// The Convex site origin auth requests actually go to: the desktop bridge's
// runtime URL when present, the baked Vite env otherwise. Callback flows that
// echo a `convexUrl` back to the desktop main process must use this same
// value, or the session token and origin can disagree.
export const AUTH_BASE_URL =
  desktopConvexSiteUrl || ((import.meta.env.VITE_CONVEX_SITE_URL as string) ?? '');

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  plugins: [convexClient(), crossDomainClient({ disableCache: true })],
  // `customFetchImpl` (not a top-level `fetch` key) is how better-auth accepts
  // a fetch override; it routes every auth request (get-session, list-accounts,
  // ...) through the Bearer-token wrapper so desktop sessions resolve a user.
  ...(isDesktop() ? { fetchOptions: { customFetchImpl: desktopAuthFetch } } : {}),
});
