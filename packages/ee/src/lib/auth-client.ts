import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import {
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

async function desktopAuthFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  let token = getDesktopCloudToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response = await fetch(input, { ...init, headers });
  if (response.status !== 401) return response;

  const refreshedToken = await refreshDesktopCloudSession();
  if (!refreshedToken) {
    if (typeof window !== 'undefined') window.location.reload();
    return response;
  }

  headers.set('Authorization', `Bearer ${refreshedToken}`);
  response = await fetch(input, { ...init, headers });
  return response;
}

export const authClient = createAuthClient({
  baseURL: desktopConvexSiteUrl || (import.meta.env.VITE_CONVEX_SITE_URL as string),
  plugins: [convexClient(), crossDomainClient({ disableCache: true })],
  // `customFetchImpl` (not a top-level `fetch` key) is how better-auth accepts
  // a fetch override; it routes every auth request (get-session, list-accounts,
  // ...) through the Bearer-token wrapper so desktop sessions resolve a user.
  ...(isDesktop() ? { fetchOptions: { customFetchImpl: desktopAuthFetch } } : {}),
});
