import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { DESKTOP_AUTH_CALLBACK_URL } from '@agendex/shared/desktop-auth-callback';
import { buildDesktopAuthUrl } from './cloud-login-url.ts';

let userDataPath = mkdtempSync(join(tmpdir(), 'agendex-cloud-login-test-'));
const cleanupPaths = new Set<string>([userDataPath]);
const openedUrls: string[] = [];
let openExternalImpl = async (url: string): Promise<void> => {
  openedUrls.push(url);
};

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
    openExternal: (url: string) => openExternalImpl(url),
  },
}));

const {
  clearPendingDesktopAuthLogin,
  completePendingDesktopAuthLogin,
  createPendingDesktopAuthLogin,
  loadPendingDesktopAuthLogin,
  startDesktopAuthLogin,
} = await import('./cloud-login.ts');

function resetUserData(): void {
  userDataPath = mkdtempSync(join(tmpdir(), 'agendex-cloud-login-test-'));
  cleanupPaths.add(userDataPath);
  openedUrls.length = 0;
  openExternalImpl = async (url: string): Promise<void> => {
    openedUrls.push(url);
  };
}

beforeEach(() => {
  resetUserData();
  clearPendingDesktopAuthLogin();
});

afterAll(() => {
  clearPendingDesktopAuthLogin();
  for (const path of cleanupPaths) {
    rmSync(path, { force: true, recursive: true });
  }
});

test('Given desktop callback metadata When building a GitHub login URL Then it targets auth desktop', () => {
  const authUrl = new URL(buildDesktopAuthUrl('https://app.agendex.dev', 'state-123', 'github'));

  expect(authUrl.origin).toBe('https://app.agendex.dev');
  expect(authUrl.pathname).toBe('/auth/desktop');
  expect(authUrl.searchParams.get('callback')).toBe(DESKTOP_AUTH_CALLBACK_URL);
  expect(authUrl.searchParams.get('state')).toBe('state-123');
  expect(authUrl.searchParams.get('provider')).toBe('github');
});

test('Given desktop callback metadata When building a Google login URL Then it preserves provider', () => {
  const authUrl = new URL(buildDesktopAuthUrl('https://app.agendex.dev', 'state-123', 'google'));

  expect(authUrl.searchParams.get('provider')).toBe('google');
});

test('Given a desktop auth provider When creating pending state Then it records high-entropy metadata', () => {
  const pending = createPendingDesktopAuthLogin('github', 1_000);

  expect(pending.state).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  expect(pending.createdAtMs).toBe(1_000);
  expect(pending.expiresAtMs).toBe(301_000);
  expect(pending.provider).toBe('github');
  expect(pending.callbackUrl).toBe(DESKTOP_AUTH_CALLBACK_URL);
});

test('Given temp userData When saving loading and clearing pending state Then disk state follows', async () => {
  const pending = await startDesktopAuthLogin('https://app.agendex.dev', 'google', {
    nowMs: () => 10_000,
    scheduleTimeout: () => ({ unref: () => undefined }),
  });

  expect(loadPendingDesktopAuthLogin(10_001)).toEqual(pending);
  expect(new URL(openedUrls[0] ?? '').pathname).toBe('/auth/desktop');
  expect(new URL(openedUrls[0] ?? '').searchParams.get('callback')).toBe(DESKTOP_AUTH_CALLBACK_URL);

  clearPendingDesktopAuthLogin();

  expect(loadPendingDesktopAuthLogin(10_002)).toBeNull();
});

test('Given malformed pending state on disk When loading pending state Then it fails closed', () => {
  writeFileSync(join(userDataPath, 'agendex-desktop-auth-pending.json'), '{"state":""}', 'utf8');

  expect(loadPendingDesktopAuthLogin(10_000)).toBeNull();
});

test('Given malformed pending JSON on disk When completing pending state Then it fails closed', () => {
  writeFileSync(join(userDataPath, 'agendex-desktop-auth-pending.json'), '{', 'utf8');

  expect(completePendingDesktopAuthLogin('state-123', 10_000)).toEqual({
    ok: false,
    reason: 'malformed-pending-login',
  });
});

test('Given stale pending state on disk When loading pending state Then it clears the attempt', async () => {
  await startDesktopAuthLogin('https://app.agendex.dev', 'github', {
    nowMs: () => 10_000,
    scheduleTimeout: () => ({ unref: () => undefined }),
  });

  expect(loadPendingDesktopAuthLogin(310_000)).toBeNull();
});

test('Given an active desktop auth attempt When starting another Then it rejects the duplicate attempt', async () => {
  await startDesktopAuthLogin('https://app.agendex.dev', 'github', {
    nowMs: () => 20_000,
    scheduleTimeout: () => ({ unref: () => undefined }),
  });

  await expect(
    startDesktopAuthLogin('https://app.agendex.dev', 'google', {
      nowMs: () => 20_001,
      scheduleTimeout: () => ({ unref: () => undefined }),
    }),
  ).rejects.toThrow('A desktop auth attempt is already active');

  expect(openedUrls).toHaveLength(1);
});

test('Given an unsupported runtime provider When starting desktop auth Then it rejects before pending state or URL creation', async () => {
  await expect(
    startDesktopAuthLogin('https://app.agendex.dev', 'gitlab' as never, {
      nowMs: () => 25_000,
      scheduleTimeout: () => ({ unref: () => undefined }),
    }),
  ).rejects.toThrow('Unsupported desktop auth provider');

  expect(loadPendingDesktopAuthLogin(25_001)).toBeNull();
  expect(openedUrls).toHaveLength(0);
});

test('Given a scheduled timeout When the timeout fires Then pending state is cleared', async () => {
  let timeoutCallback = (): void => {
    throw new Error('timeout callback was not scheduled');
  };
  await startDesktopAuthLogin('https://app.agendex.dev', 'github', {
    nowMs: () => 30_000,
    scheduleTimeout: (callback: () => void) => {
      timeoutCallback = callback;
      return { unref: () => undefined };
    },
  });

  timeoutCallback();

  expect(loadPendingDesktopAuthLogin(30_001)).toBeNull();
});

test('Given shell.openExternal fails When starting login Then pending state is cleared', async () => {
  openExternalImpl = async (): Promise<void> => {
    throw new Error('browser unavailable');
  };

  await expect(
    startDesktopAuthLogin('https://app.agendex.dev', 'github', {
      nowMs: () => 40_000,
      scheduleTimeout: () => ({ unref: () => undefined }),
    }),
  ).rejects.toThrow('browser unavailable');

  expect(loadPendingDesktopAuthLogin(40_001)).toBeNull();
});

test('Given a matching callback state When completing pending login Then it consumes state once', async () => {
  const pending = await startDesktopAuthLogin('https://app.agendex.dev', 'github', {
    nowMs: () => 50_000,
    scheduleTimeout: () => ({ unref: () => undefined }),
  });

  const completed = completePendingDesktopAuthLogin(pending.state, 50_001);

  expect(completed).toEqual({ ok: true, pending });
  expect(loadPendingDesktopAuthLogin(50_002)).toBeNull();
  expect(completePendingDesktopAuthLogin(pending.state, 50_003)).toEqual({
    ok: false,
    reason: 'missing-pending-login',
  });
});
