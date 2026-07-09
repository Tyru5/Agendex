import { afterEach, expect, test } from 'bun:test';
import { desktopAuthFetch } from './auth-client.ts';
import type { AgendexDesktopBridge } from './desktop.ts';

type TestLocation = {
  reload: () => void;
};

type TestDesktopWindow = {
  readonly agendexDesktop: AgendexDesktopBridge;
  readonly location: TestLocation;
};

function installDesktopWindow(bridge: Partial<AgendexDesktopBridge> = {}) {
  let reloadCount = 0;
  const desktop: AgendexDesktopBridge = {
    isDesktop: true,
    cloudToken: null,
    convexSiteUrl: null,
    login: async () => false,
    logout: async () => true,
    setModePref: async () => true,
    refreshCloudSession: async () => null,
    getConvexAuthToken: async () => null,
    ...bridge,
  };

  const desktopWindow: TestDesktopWindow = {
    agendexDesktop: desktop,
    location: {
      reload: () => {
        reloadCount += 1;
      },
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: desktopWindow,
  });

  return {
    desktop,
    getReloadCount: () => reloadCount,
  };
}

function uninstallDesktopWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  uninstallDesktopWindow();
});

test('desktopAuthFetch does not reload on 401 when there is no stored cloud token', async () => {
  const { getReloadCount } = installDesktopWindow({ cloudToken: null });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  try {
    const response = await desktopAuthFetch('http://localhost/api/auth/get-session');
    expect(response.status).toBe(401);
    expect(getReloadCount()).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktopAuthFetch reloads on 401 when a stored cloud token cannot be refreshed', async () => {
  const { getReloadCount } = installDesktopWindow({
    cloudToken: 'stale-token',
    convexSiteUrl: 'https://example.convex.site',
    refreshCloudSession: async () => null,
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  try {
    const response = await desktopAuthFetch('http://localhost/api/auth/get-session');
    expect(response.status).toBe(401);
    expect(getReloadCount()).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktopAuthFetch retries once after a successful cloud session refresh', async () => {
  const { getReloadCount } = installDesktopWindow({
    cloudToken: 'stale-token',
    convexSiteUrl: 'https://example.convex.site',
    refreshCloudSession: async () => ({
      token: 'fresh-token',
      convexSiteUrl: 'https://example.convex.site',
    }),
  });
  const originalFetch = globalThis.fetch;
  const authHeaders: Array<string | null> = [];
  let calls = 0;

  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    authHeaders.push(headers.get('Authorization'));
    if (calls === 1) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ user: { id: 'u1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const response = await desktopAuthFetch('http://localhost/api/auth/get-session');
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(authHeaders[0]).toBe('Bearer stale-token');
    expect(authHeaders[1]).toBe('Bearer fresh-token');
    expect(getReloadCount()).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
