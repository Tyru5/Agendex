import { afterEach, expect, test } from 'bun:test';
import { handleDesktopAuthFetch } from './desktop-auth-fetch.ts';

const deps = {
  loadCloudCreds: () => ({
    token: 'stored-session-token',
    convexSiteUrl: 'https://example.convex.site',
  }),
};

function createTestFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: globalThis.fetch.preconnect });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function resultHeader(headers: readonly [string, string][], name: string): string | null {
  const expected = name.toLowerCase();
  for (const [headerName, value] of headers) {
    if (headerName.toLowerCase() === expected) return value;
  }
  return null;
}

test('proxies trusted desktop auth fetches through the main process', async () => {
  // Given
  const received: Array<{ readonly input: RequestInfo | URL; readonly init?: RequestInit }> = [];
  globalThis.fetch = createTestFetch(async (input, init) => {
    received.push({ input, init });
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Auth-Trace': 'safe' });
    headers.append('Set-Cookie', 'session=secret; HttpOnly');
    return new Response(JSON.stringify({ user: { id: 'u1' } }), {
      headers,
      status: 200,
      statusText: 'OK',
    });
  });

  // When
  const result = await handleDesktopAuthFetch(
    deps,
    'https://example.convex.site/api/auth/session',
    {
      body: null,
      headers: [['authorization', 'Bearer desktop-cloud-token']],
      method: 'GET',
    },
  );

  // Then
  expect(result.status).toBe(200);
  expect(result.body).toBe(JSON.stringify({ user: { id: 'u1' } }));
  expect(received).toHaveLength(1);
  expect(received[0]?.input).toBe('https://example.convex.site/api/auth/session');
  expect(new Headers(received[0]?.init?.headers).get('authorization')).toBe(
    'Bearer desktop-cloud-token',
  );
  expect(resultHeader(result.headers, 'set-cookie')).toBeNull();
  expect(resultHeader(result.headers, 'x-auth-trace')).toBe('safe');
});

test('rejects desktop auth fetches outside the stored Convex site', async () => {
  // Given
  let fetchCalled = false;
  globalThis.fetch = createTestFetch(async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  });

  // When
  const result = await handleDesktopAuthFetch(deps, 'https://attacker.example/api/auth/session', {
    body: null,
    headers: [],
    method: 'GET',
  });

  // Then
  expect(result.status).toBe(403);
  expect(fetchCalled).toBe(false);
});

test('rejects malformed desktop auth fetch payloads', async () => {
  // Given
  let fetchCalled = false;
  globalThis.fetch = createTestFetch(async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  });

  // When
  const result = await handleDesktopAuthFetch(
    deps,
    'https://example.convex.site/api/auth/session',
    {
      body: null,
      headers: [['authorization']],
      method: 'GET',
    },
  );

  // Then
  expect(result.status).toBe(400);
  expect(fetchCalled).toBe(false);
});
