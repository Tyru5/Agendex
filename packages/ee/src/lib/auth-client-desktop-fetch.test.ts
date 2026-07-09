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
  let logoutCount = 0;
  const desktop: AgendexDesktopBridge = {
    isDesktop: true,
    cloudToken: null,
    convexSiteUrl: null,
    login: async () => false,
    logout: async () => {
      logoutCount += 1;
      desktop.cloudToken = null;
      desktop.convexSiteUrl = null;
      return true;
    },
    setModePref: async () => true,
    refreshCloudSession: async () => null,
    getConvexAuthToken: async () => null,
    ...bridge,
  };

  // Preserve logout wrapper if caller overrode logout without counting.
  if (bridge.logout) {
    const override = bridge.logout;
    desktop.logout = async () => {
      logoutCount += 1;
      return override();
    };
  }

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
    getLogoutCount: () => logoutCount,
  };
}

function uninstallDesktopWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
}

function authorizationFromFetchArgs(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (input instanceof Request) return input.headers.get('Authorization');
  return new Headers(init?.headers).get('Authorization');
}

async function bodyFromFetchArgs(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  if (input instanceof Request) {
    try {
      return await input.text();
    } catch {
      return null;
    }
  }
  if (typeof init?.body === 'string') return init.body;
  return null;
}

afterEach(() => {
  uninstallDesktopWindow();
});

test('desktopAuthFetch does not reload on 401 when there is no stored cloud token', async () => {
  const { getReloadCount, getLogoutCount } = installDesktopWindow({ cloudToken: null });
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
    expect(getLogoutCount()).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktopAuthFetch clears the session then reloads when a stored token cannot be refreshed', async () => {
  const { desktop, getReloadCount, getLogoutCount } = installDesktopWindow({
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
    expect(getLogoutCount()).toBe(1);
    expect(desktop.cloudToken).toBeNull();
    expect(desktop.convexSiteUrl).toBeNull();
    expect(getReloadCount()).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktopAuthFetch retries once after a successful cloud session refresh', async () => {
  const { getReloadCount, getLogoutCount } = installDesktopWindow({
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

  globalThis.fetch = (async (input, init) => {
    calls += 1;
    authHeaders.push(authorizationFromFetchArgs(input, init));
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
    expect(getLogoutCount()).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktopAuthFetch re-sends a POST body after a successful token refresh', async () => {
  installDesktopWindow({
    cloudToken: 'stale-token',
    convexSiteUrl: 'https://example.convex.site',
    refreshCloudSession: async () => ({
      token: 'fresh-token',
      convexSiteUrl: 'https://example.convex.site',
    }),
  });
  const originalFetch = globalThis.fetch;
  const bodies: Array<string | null> = [];
  let calls = 0;

  globalThis.fetch = (async (input, init) => {
    calls += 1;
    bodies.push(await bodyFromFetchArgs(input, init));
    if (calls === 1) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const response = await desktopAuthFetch('http://localhost/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github' }),
    });
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(bodies[0]).toBe(JSON.stringify({ provider: 'github' }));
    expect(bodies[1]).toBe(JSON.stringify({ provider: 'github' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
