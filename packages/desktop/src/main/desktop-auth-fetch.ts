import { normalizeConvexSiteUrl } from '@agendex/shared/convex-url';
import type { CloudCreds } from './cloud-auth.ts';

type DesktopAuthFetchInit = {
  readonly method: string;
  readonly headers: readonly [string, string][];
  readonly body: string | null;
};

export type DesktopAuthFetchResult = {
  readonly body: string | null;
  readonly headers: readonly [string, string][];
  readonly status: number;
  readonly statusText: string;
};

type DesktopAuthFetchDeps = {
  readonly loadCloudCreds: () => CloudCreds | null;
};

const FORBIDDEN_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);

function createDesktopAuthFetchResponse(
  status: number,
  statusText: string,
  body: string | null,
): DesktopAuthFetchResult {
  const headers: readonly [string, string][] = body ? [['Content-Type', 'application/json']] : [];
  return {
    body,
    headers,
    status,
    statusText,
  };
}

function parseHeaderTuples(value: unknown): readonly [string, string][] | null {
  if (!Array.isArray(value)) return null;
  const headers: [string, string][] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [name, headerValue] = item;
    if (typeof name !== 'string' || typeof headerValue !== 'string') return null;
    headers.push([name, headerValue]);
  }
  return headers;
}

function parseDesktopAuthFetchInit(value: unknown): DesktopAuthFetchInit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const method = Reflect.get(value, 'method');
  const headers = parseHeaderTuples(Reflect.get(value, 'headers'));
  const body = Reflect.get(value, 'body');
  if (typeof method !== 'string' || !headers) return null;
  if (body !== null && typeof body !== 'string') return null;
  return { method, headers, body };
}

function canProxyDesktopAuthFetch(deps: DesktopAuthFetchDeps, value: string): boolean {
  const cloud = deps.loadCloudCreds();
  if (!cloud) return false;

  try {
    const url = new URL(value);
    const requestOrigin = normalizeConvexSiteUrl(url.origin);
    return (
      requestOrigin !== null &&
      requestOrigin === cloud.convexSiteUrl &&
      url.pathname.startsWith('/api/auth/')
    );
  } catch (err) {
    if (err instanceof TypeError) return false;
    throw err;
  }
}

async function proxyDesktopAuthFetch(
  deps: DesktopAuthFetchDeps,
  url: string,
  init: DesktopAuthFetchInit,
): Promise<DesktopAuthFetchResult> {
  if (!canProxyDesktopAuthFetch(deps, url)) {
    return createDesktopAuthFetchResponse(403, 'Forbidden', JSON.stringify({ error: 'Forbidden' }));
  }

  const requestHeaders = new Headers();
  for (const [name, value] of init.headers) {
    requestHeaders.append(name, value);
  }
  const response = await fetch(url, {
    body: init.body ?? undefined,
    headers: requestHeaders,
    method: init.method,
  });
  const responseHeaders = Array.from(response.headers.entries()).filter(
    ([name]) => !FORBIDDEN_RESPONSE_HEADERS.has(name.toLowerCase()),
  );
  return {
    body: await response.text(),
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  };
}

export async function handleDesktopAuthFetch(
  deps: DesktopAuthFetchDeps,
  url: unknown,
  init: unknown,
): Promise<DesktopAuthFetchResult> {
  if (typeof url !== 'string') {
    return createDesktopAuthFetchResponse(
      400,
      'Bad Request',
      JSON.stringify({ error: 'Bad Request' }),
    );
  }
  const parsedInit = parseDesktopAuthFetchInit(init);
  if (!parsedInit) {
    return createDesktopAuthFetchResponse(
      400,
      'Bad Request',
      JSON.stringify({ error: 'Bad Request' }),
    );
  }
  return proxyDesktopAuthFetch(deps, url, parsedInit);
}
