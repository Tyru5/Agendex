import { describe, expect, test } from 'bun:test';

import { createDesktopAuthCallbackUrl } from '@agendex/shared/desktop-auth-callback';
import type { PendingDesktopAuthLogin } from './cloud-login.ts';
import {
  createDesktopProtocolController,
  extractDesktopAuthCallbackUrl,
  registerDesktopProtocolClient,
} from './desktop-protocol.ts';

const NOW_MS = 10_000;
const PENDING: PendingDesktopAuthLogin = {
  state: 'state-123',
  createdAtMs: 9_000,
  expiresAtMs: 20_000,
  provider: 'github',
  callbackUrl: 'agendex://auth/callback',
};

type NavigationCall = 'focus-existing' | 'reload-existing' | 'create-dashboard';
type TestCreds = { readonly token: string; readonly convexSiteUrl: string };

function callbackUrl(
  input: {
    readonly state?: string;
    readonly token?: string;
    readonly convexUrl?: string;
  } = {},
): string {
  return (
    createDesktopAuthCallbackUrl({
      token: input.token ?? 'callback-token',
      state: input.state ?? PENDING.state,
      convexUrl: input.convexUrl ?? 'http://127.0.0.1:3211/api/auth/callback/github',
    }) ?? 'agendex://auth/callback'
  );
}

function createHarness(
  options: {
    readonly pending?: PendingDesktopAuthLogin | null;
    readonly validateResult?: TestCreds | null;
    readonly hasWindow?: boolean;
    readonly isWindowDestroyed?: boolean;
  } = {},
) {
  const savedCreds: TestCreds[] = [];
  const completedStates: string[] = [];
  const navigationCalls: NavigationCall[] = [];
  const logs: string[] = [];
  const pending = options.pending === undefined ? PENDING : options.pending;
  const validateResult =
    options.validateResult === undefined
      ? { token: 'rotated-token', convexSiteUrl: 'http://127.0.0.1:3211' }
      : options.validateResult;

  return {
    controller: createDesktopProtocolController({
      loadPendingLogin: () => pending,
      completePendingLogin: (state: string) => {
        completedStates.push(state);
        if (!pending) return { ok: false, reason: 'missing-pending-login' };
        if (NOW_MS >= pending.expiresAtMs) return { ok: false, reason: 'state-expired' };
        if (pending.state !== state) return { ok: false, reason: 'state-mismatch' };
        return { ok: true, pending };
      },
      validateCloudCreds: async (_creds: TestCreds) => validateResult,
      saveCloudCreds: (creds: TestCreds) => {
        savedCreds.push(creds);
      },
      getWindowState: () => ({
        hasWindow: options.hasWindow ?? true,
        isDestroyed: options.isWindowDestroyed ?? false,
      }),
      reloadDashboardWindow: () => {
        navigationCalls.push('reload-existing');
      },
      focusDashboardWindow: () => {
        navigationCalls.push('focus-existing');
      },
      createDashboardWindow: () => {
        navigationCalls.push('create-dashboard');
      },
      log: (message: string) => {
        logs.push(message);
      },
      nowMs: () => NOW_MS,
    }),
    savedCreds,
    completedStates,
    navigationCalls,
    logs,
  };
}

describe('desktop auth protocol argv extraction', () => {
  test('Given open-url callback text When extracting protocol URL Then it returns only the callback', () => {
    // Given
    const rawUrl = callbackUrl({ token: 'open-url-token' });

    // When
    const extracted = extractDesktopAuthCallbackUrl(['--flag', rawUrl]);

    // Then
    expect(extracted).toBe(rawUrl);
  });

  test('Given second-instance argv When extracting protocol URL Then it finds the callback argument', () => {
    // Given
    const rawUrl = callbackUrl({ token: 'second-instance-token' });

    // When
    const extracted = extractDesktopAuthCallbackUrl([
      '/Applications/Agendex.app/Contents/MacOS/Agendex',
      '--',
      rawUrl,
    ]);

    // Then
    expect(extracted).toBe(rawUrl);
  });

  test('Given cold-start argv When extracting protocol URL Then it finds the callback argument', () => {
    // Given
    const rawUrl = callbackUrl({ token: 'cold-start-token' });

    // When
    const extracted = extractDesktopAuthCallbackUrl([
      '/Applications/Agendex.app/Contents/MacOS/Agendex',
      rawUrl,
    ]);

    // Then
    expect(extracted).toBe(rawUrl);
  });
});

describe('desktop auth protocol completion', () => {
  test('Given backend is not ready When open-url callback arrives Then it queues and drains later', async () => {
    // Given
    const harness = createHarness();
    const rawUrl = callbackUrl();

    // When
    harness.controller.enqueueProtocolUrl(rawUrl);

    // Then
    expect(harness.savedCreds).toEqual([]);

    // When
    await harness.controller.drainQueuedCallbacks();

    // Then
    expect(harness.savedCreds).toEqual([
      { token: 'rotated-token', convexSiteUrl: 'http://127.0.0.1:3211' },
    ]);
  });

  test('Given no pending login When callback completes Then it rejects without persistence', async () => {
    // Given
    const harness = createHarness({ pending: null });

    // When
    const completed = await harness.controller.completeProtocolCallback(callbackUrl());

    // Then
    expect(completed).toBe(false);
    expect(harness.savedCreds).toEqual([]);
  });

  test('Given mismatched pending state When callback completes Then it rejects without persistence', async () => {
    // Given
    const harness = createHarness();

    // When
    const completed = await harness.controller.completeProtocolCallback(
      callbackUrl({ state: 'other-state' }),
    );

    // Then
    expect(completed).toBe(false);
    expect(harness.savedCreds).toEqual([]);
    expect(harness.completedStates).toEqual([]);
  });

  test('Given expired pending state When callback completes Then it rejects without persistence', async () => {
    // Given
    const harness = createHarness({
      pending: { ...PENDING, expiresAtMs: NOW_MS },
    });

    // When
    const completed = await harness.controller.completeProtocolCallback(callbackUrl());

    // Then
    expect(completed).toBe(false);
    expect(harness.savedCreds).toEqual([]);
  });

  test('Given untrusted Convex callback URL When callback completes Then it rejects without persistence', async () => {
    // Given
    const harness = createHarness();
    const rawUrl = `agendex://auth/callback?token=callback-token&state=${PENDING.state}&convexUrl=${encodeURIComponent('https://attacker.example')}`;

    // When
    const completed = await harness.controller.completeProtocolCallback(rawUrl);

    // Then
    expect(completed).toBe(false);
    expect(harness.savedCreds).toEqual([]);
  });

  test('Given replayed callback after success When callback completes again Then it is rejected', async () => {
    // Given
    let pending: PendingDesktopAuthLogin | null = PENDING;
    const savedCreds: TestCreds[] = [];
    const controller = createDesktopProtocolController({
      loadPendingLogin: () => pending,
      completePendingLogin: (state: string) => {
        if (!pending) return { ok: false, reason: 'missing-pending-login' };
        if (pending.state !== state) return { ok: false, reason: 'state-mismatch' };
        const completed = pending;
        pending = null;
        return { ok: true, pending: completed };
      },
      validateCloudCreds: async (creds: TestCreds) => ({
        ...creds,
        token: 'rotated-token',
      }),
      saveCloudCreds: (creds: TestCreds) => {
        savedCreds.push(creds);
      },
      getWindowState: () => ({ hasWindow: true, isDestroyed: false }),
      reloadDashboardWindow: () => undefined,
      focusDashboardWindow: () => undefined,
      createDashboardWindow: () => undefined,
      log: () => undefined,
      nowMs: () => NOW_MS,
    });
    const rawUrl = callbackUrl();

    // When
    const first = await controller.completeProtocolCallback(rawUrl);
    const second = await controller.completeProtocolCallback(rawUrl);

    // Then
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(savedCreds).toHaveLength(1);
  });

  test('Given cloud validation fails When callback completes Then it returns false and does not persist', async () => {
    // Given
    const harness = createHarness({ validateResult: null });

    // When
    const completed = await harness.controller.completeProtocolCallback(callbackUrl());

    // Then
    expect(completed).toBe(false);
    expect(harness.savedCreds).toEqual([]);
  });

  test('Given pending IPC login promise When callback succeeds Then it resolves true', async () => {
    // Given
    const harness = createHarness();
    const loginPromise = harness.controller.createPendingLoginCompletion(PENDING.state);

    // When
    const completed = await harness.controller.completeProtocolCallback(callbackUrl());

    // Then
    expect(completed).toBe(true);
    await expect(loginPromise).resolves.toBe(true);
    expect(harness.navigationCalls).toEqual([]);
  });

  test('Given pending IPC login promise When the attempt expires Then it resolves false so the renderer can retry', async () => {
    // Given
    let timeoutCallback: (() => void) | undefined;
    let timeoutDelayMs: number | undefined;
    const controller = createDesktopProtocolController({
      loadPendingLogin: () => PENDING,
      completePendingLogin: () => ({ ok: false, reason: 'missing-pending-login' }),
      validateCloudCreds: async () => null,
      saveCloudCreds: () => undefined,
      getWindowState: () => ({ hasWindow: true, isDestroyed: false }),
      reloadDashboardWindow: () => undefined,
      focusDashboardWindow: () => undefined,
      createDashboardWindow: () => undefined,
      log: () => undefined,
      nowMs: () => NOW_MS,
      scheduleTimeout: (callback: () => void, delayMs: number) => {
        timeoutCallback = callback;
        timeoutDelayMs = delayMs;
        return { unref: () => undefined };
      },
    });

    // When
    const loginPromise = controller.createPendingLoginCompletion(
      PENDING.state,
      PENDING.expiresAtMs,
    );
    timeoutCallback?.();

    // Then
    expect(timeoutDelayMs).toBe(PENDING.expiresAtMs - NOW_MS);
    await expect(loginPromise).resolves.toBe(false);
  });

  test('Given callback without pending IPC promise When completing Then it reloads or creates dashboard as appropriate', async () => {
    // Given
    const liveWindowHarness = createHarness({ hasWindow: true });
    const missingWindowHarness = createHarness({ hasWindow: false });

    // When
    const liveWindowCompleted =
      await liveWindowHarness.controller.completeProtocolCallback(callbackUrl());
    const missingWindowCompleted =
      await missingWindowHarness.controller.completeProtocolCallback(callbackUrl());

    // Then
    expect(liveWindowCompleted).toBe(true);
    expect(missingWindowCompleted).toBe(true);
    expect(liveWindowHarness.navigationCalls).toEqual(['reload-existing', 'focus-existing']);
    expect(missingWindowHarness.navigationCalls).toEqual(['create-dashboard']);
  });

  test('Given token-bearing callback When completion logs Then log text is redacted', async () => {
    // Given
    const harness = createHarness({ pending: null });

    // When
    await harness.controller.completeProtocolCallback(callbackUrl({ token: 'secret-token' }));

    // Then
    expect(harness.logs.join('\n')).toContain('token=%3Credacted%3E');
    expect(harness.logs.join('\n')).not.toContain('secret-token');
  });
});

describe('desktop protocol runtime registration', () => {
  test('Given packaged and dev runtimes When registering protocol client Then it uses the right Electron arguments', () => {
    // Given
    const packagedCalls: Array<readonly unknown[]> = [];
    const devCalls: Array<readonly unknown[]> = [];

    // When
    registerDesktopProtocolClient({
      isDefaultApp: false,
      execPath: '/Applications/Agendex.app/Contents/MacOS/Agendex',
      argv: [],
      setAsDefaultProtocolClient: (...args: readonly unknown[]) => {
        packagedCalls.push(args);
        return true;
      },
    });
    registerDesktopProtocolClient({
      isDefaultApp: true,
      execPath: '/usr/local/bin/electron',
      argv: ['/repo/node_modules/electron/dist/Electron.app', '/repo/packages/desktop'],
      setAsDefaultProtocolClient: (...args: readonly unknown[]) => {
        devCalls.push(args);
        return true;
      },
    });

    // Then
    expect(packagedCalls).toEqual([['agendex']]);
    expect(devCalls).toEqual([['agendex', '/usr/local/bin/electron', ['/repo/packages/desktop']]]);
  });
});
