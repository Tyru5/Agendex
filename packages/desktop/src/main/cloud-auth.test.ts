import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, mock, test } from 'bun:test';

let userDataPath = '';

mock.module('electron', () => ({
  app: {
    getPath: () => userDataPath,
  },
  safeStorage: {
    decryptString: () => '',
    encryptString: () => Buffer.from(''),
    isEncryptionAvailable: () => true,
  },
  shell: {
    openExternal: async () => undefined,
  },
}));

function withTempUserData(work: () => void): void {
  userDataPath = mkdtempSync(join(tmpdir(), 'agendex-cloud-auth-test-'));
  try {
    work();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
    userDataPath = '';
  }
}

async function withTempUserDataAsync(work: () => Promise<void>): Promise<void> {
  userDataPath = mkdtempSync(join(tmpdir(), 'agendex-cloud-auth-test-'));
  try {
    await work();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
    userDataPath = '';
  }
}

test('validates callback tokens through the CLI refresh endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const requestedAuthHeaders: Array<string | null> = [];

  async function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    requestedUrls.push(requestUrl);
    const headers = new Headers(init?.headers);
    requestedAuthHeaders.push(headers.get('Authorization'));

    if (requestUrl === 'http://127.0.0.1:3211/api/cli/refresh') {
      return Response.json({ token: 'refreshed-token', expiresAt: Date.now() + 60_000 });
    }

    return Response.json({ session: null });
  }

  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchImpl });

  const { validateCloudCreds } = await import('./cloud-auth.ts');
  let validated: Awaited<ReturnType<typeof validateCloudCreds>>;
  try {
    validated = await validateCloudCreds({
      token: 'callback-token',
      convexSiteUrl: 'http://127.0.0.1:3211',
    });
  } finally {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
  }

  expect(validated).toEqual({
    token: 'refreshed-token',
    convexSiteUrl: 'http://127.0.0.1:3211',
  });
  expect(requestedUrls).toEqual(['http://127.0.0.1:3211/api/cli/refresh']);
  expect(requestedAuthHeaders).toEqual(['Bearer callback-token']);
});

test('validates production callback tokens against the Convex site HTTP action host', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  async function fetchImpl(input: RequestInfo | URL): Promise<Response> {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    requestedUrls.push(requestUrl);

    if (requestUrl === 'https://enduring-eagle-295.convex.site/api/cli/refresh') {
      return Response.json({ token: 'refreshed-token', expiresAt: Date.now() + 60_000 });
    }

    return Response.json({ error: 'wrong host' }, { status: 404 });
  }

  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchImpl });

  const { validateCloudCreds } = await import('./cloud-auth.ts');
  let validated: Awaited<ReturnType<typeof validateCloudCreds>>;
  try {
    validated = await validateCloudCreds({
      token: 'callback-token',
      convexSiteUrl: 'https://enduring-eagle-295.convex.site',
    });
  } finally {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
  }

  expect(validated).toEqual({
    token: 'refreshed-token',
    convexSiteUrl: 'https://enduring-eagle-295.convex.site',
  });
  expect(requestedUrls).toEqual(['https://enduring-eagle-295.convex.site/api/cli/refresh']);
});

test('Given refresh returns 500 When validating callback creds Then validation fails closed without persistence', async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => Response.json({ error: 'unavailable' }, { status: 500 }),
  });

  await withTempUserDataAsync(async () => {
    const { clearCloudCreds, loadCloudCreds, validateCloudCreds } = await import('./cloud-auth.ts');
    try {
      clearCloudCreds();

      const validated = await validateCloudCreds({
        token: 'callback-token',
        convexSiteUrl: 'http://127.0.0.1:3211',
      });

      expect(validated === null).toBe(true);
      expect(loadCloudCreds()).toBeNull();
    } finally {
      clearCloudCreds();
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
    }
  });
});

test('Given refresh cannot be reached When validating callback creds Then validation fails closed without persistence', async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      throw new Error('refresh offline');
    },
  });

  await withTempUserDataAsync(async () => {
    const { clearCloudCreds, loadCloudCreds, validateCloudCreds } = await import('./cloud-auth.ts');
    try {
      clearCloudCreds();

      const validated = await validateCloudCreds({
        token: 'callback-token',
        convexSiteUrl: 'http://127.0.0.1:3211',
      });

      expect(validated === null).toBe(true);
      expect(loadCloudCreds()).toBeNull();
    } finally {
      clearCloudCreds();
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
    }
  });
});

test('persists fixed QA fixture creds without safeStorage only when the QA plaintext gate is enabled', async () => {
  const originalGate = process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS;
  const { clearCloudCreds, loadCloudCreds, saveCloudCreds } = await import('./cloud-auth.ts');

  withTempUserData(() => {
    try {
      process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS = 'true';

      saveCloudCreds({
        token: 'qa-fixture-token',
        convexSiteUrl: 'http://127.0.0.1:3211',
      });

      expect(loadCloudCreds()).toEqual({
        token: 'qa-fixture-token',
        convexSiteUrl: 'http://127.0.0.1:3211',
      });
    } finally {
      clearCloudCreds();
      if (originalGate === undefined) {
        delete process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS;
      } else {
        process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS = originalGate;
      }
    }
  });
});

test('Given cloud creds appear after an empty bootstrap When loading again Then the new session is read', async () => {
  const originalGate = process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS;
  const { clearCloudCreds, loadCloudCreds } = await import('./cloud-auth.ts');

  withTempUserData(() => {
    try {
      process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS = 'true';

      clearCloudCreds();
      expect(loadCloudCreds()).toBeNull();

      writeFileSync(
        join(userDataPath, 'agendex-cloud.json'),
        JSON.stringify({
          token: 'late-session-token',
          enc: 'qa-plaintext',
          convexSiteUrl: 'http://127.0.0.1:3211',
        }),
        'utf8',
      );

      expect(loadCloudCreds()).toEqual({
        token: 'late-session-token',
        convexSiteUrl: 'http://127.0.0.1:3211',
      });
    } finally {
      clearCloudCreds();
      if (originalGate === undefined) {
        delete process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS;
      } else {
        process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS = originalGate;
      }
    }
  });
});

test('Given stored cloud session When requesting a Convex auth token Then main process uses the Convex site endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const originalGate = process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS;
  const requestedUrls: string[] = [];
  const requestedAuthHeaders: Array<string | null> = [];

  async function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    requestedUrls.push(requestUrl);
    const headers = new Headers(init?.headers);
    requestedAuthHeaders.push(headers.get('Authorization'));

    if (requestUrl === 'https://enduring-eagle-295.convex.site/api/cli/convex-token') {
      return Response.json({ token: 'convex-jwt' });
    }

    return Response.json({ error: 'wrong host' }, { status: 404 });
  }

  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchImpl });

  await withTempUserDataAsync(async () => {
    const { clearCloudCreds, getConvexAuthToken, saveCloudCreds } = await import('./cloud-auth.ts');
    try {
      process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS = 'true';
      clearCloudCreds();
      saveCloudCreds({
        token: 'desktop-cloud-token',
        convexSiteUrl: 'https://enduring-eagle-295.convex.site',
      });

      const result = await getConvexAuthToken();

      expect(result).toEqual({
        token: 'convex-jwt',
        cloudSession: {
          token: 'desktop-cloud-token',
          convexSiteUrl: 'https://enduring-eagle-295.convex.site',
        },
      });
      expect(requestedUrls).toEqual([
        'https://enduring-eagle-295.convex.site/api/cli/convex-token',
      ]);
      expect(requestedAuthHeaders).toEqual(['Bearer desktop-cloud-token']);
    } finally {
      clearCloudCreds();
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
      if (originalGate === undefined) {
        delete process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS;
      } else {
        process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS = originalGate;
      }
    }
  });
});
