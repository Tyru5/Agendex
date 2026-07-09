import { afterEach, expect, test } from 'bun:test';
import { desktopAuthFetch } from './auth-client.ts';
import type { AgendexDesktopBridge, DesktopAuthFetchInit } from './desktop.ts';

type AuthFetchCall = {
  readonly url: string;
  readonly init: DesktopAuthFetchInit;
};

const authFetchCalls: AuthFetchCall[] = [];

function createTestFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: globalThis.fetch.preconnect });
}

function installDesktopWindow() {
  const desktop: AgendexDesktopBridge = {
    isDesktop: true,
    cloudToken: 'desktop-cloud-token',
    convexSiteUrl: 'https://example.convex.site',
    login: async () => false,
    logout: async () => true,
    setModePref: async () => true,
    refreshCloudSession: async () => null,
    getConvexAuthToken: async () => null,
    authFetch: async (url, init) => {
      authFetchCalls.push({ url, init });
      return {
        body: JSON.stringify({ ok: true }),
        headers: [['Content-Type', 'application/json']],
        status: 200,
        statusText: 'OK',
      };
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      agendexDesktop: desktop,
      location: {
        reload: () => undefined,
      },
    },
  });
}

function uninstallDesktopWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  authFetchCalls.length = 0;
  uninstallDesktopWindow();
});

test('desktopAuthFetch routes cloud auth requests through the desktop bridge', async () => {
  // Given
  installDesktopWindow();
  const originalFetch = globalThis.fetch;
  let browserFetchCalls = 0;
  globalThis.fetch = createTestFetch(async () => {
    browserFetchCalls += 1;
    return new Response(null, { status: 599 });
  });

  try {
    // When
    const response = await desktopAuthFetch('https://example.convex.site/api/auth/list-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeSessions: false }),
    });

    // Then
    expect(response.status).toBe(200);
    expect(browserFetchCalls).toBe(0);
    expect(authFetchCalls).toEqual([
      {
        url: 'https://example.convex.site/api/auth/list-accounts',
        init: {
          method: 'POST',
          headers: [
            ['authorization', 'Bearer desktop-cloud-token'],
            ['content-type', 'application/json'],
          ],
          body: JSON.stringify({ includeSessions: false }),
        },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
