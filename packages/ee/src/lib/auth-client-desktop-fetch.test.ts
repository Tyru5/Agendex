import { afterEach, expect, test } from 'bun:test';
import { desktopAuthFetch } from './auth-client.ts';
import {
  authorizationFromFetchArgs,
  bodyFromFetchArgs,
  createTestFetch,
  installDesktopWindow,
  uninstallDesktopWindow,
} from './auth-client-desktop-test-helpers.ts';

afterEach(() => {
  uninstallDesktopWindow();
});

test('desktopAuthFetch does not reload on 401 when there is no stored cloud token', async () => {
  let bridgeFetchCalls = 0;
  const { getReloadCount, getLogoutCount } = installDesktopWindow({
    cloudToken: null,
    authFetch: async () => {
      bridgeFetchCalls += 1;
      return {
        body: JSON.stringify({ error: 'forbidden' }),
        headers: [['Content-Type', 'application/json']],
        status: 403,
        statusText: 'Forbidden',
      };
    },
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = createTestFetch(
    async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

  try {
    const response = await desktopAuthFetch('http://localhost/api/auth/get-session');
    expect(response.status).toBe(401);
    expect(bridgeFetchCalls).toBe(0);
    expect(getReloadCount()).toBe(0);
    expect(getLogoutCount()).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktopAuthFetch fallback preserves POST bodies when there is no desktop bridge', async () => {
  uninstallDesktopWindow();
  const originalFetch = globalThis.fetch;
  const bodies: Array<string | null> = [];

  globalThis.fetch = createTestFetch(async (input, init) => {
    bodies.push(await bodyFromFetchArgs(input, init));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const response = await desktopAuthFetch('http://localhost/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github' }),
    });
    expect(response.status).toBe(200);
    expect(bodies).toEqual([JSON.stringify({ provider: 'github' })]);
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

  globalThis.fetch = createTestFetch(
    async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

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

  globalThis.fetch = createTestFetch(async (input, init) => {
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
  });

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

test('desktopAuthFetch uses a refreshed cloud token on subsequent requests', async () => {
  installDesktopWindow({
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

  globalThis.fetch = createTestFetch(async (input, init) => {
    calls += 1;
    authHeaders.push(authorizationFromFetchArgs(input, init));
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
  });

  try {
    await desktopAuthFetch('http://localhost/api/auth/get-session');
    await desktopAuthFetch('http://localhost/api/auth/list-accounts');
    expect(authHeaders).toEqual(['Bearer stale-token', 'Bearer fresh-token', 'Bearer fresh-token']);
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

  globalThis.fetch = createTestFetch(async (input, init) => {
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
  });

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
