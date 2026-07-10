import { expect, test } from 'bun:test';
import type { CloudCreds, ConvexAuthTokenResult } from './cloud-auth.ts';
import { registerDesktopIpc } from './desktop-ipc.ts';

type IpcHandler = (_event: unknown, ...args: unknown[]) => unknown;

class FakeIpcMain {
  readonly handlers = new Map<string, IpcHandler>();
  readonly listeners = new Map<string, IpcHandler>();

  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler);
  }

  on(channel: string, listener: IpcHandler): void {
    this.listeners.set(channel, listener);
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return await handler({}, ...args);
  }
}

const cloudCreds: CloudCreds = {
  token: 'cloud-token',
  convexSiteUrl: 'https://example.convex.site',
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function register(
  overrides: Partial<{
    loadCloudCreds: () => CloudCreds | null;
    refreshCloudSession: () => Promise<CloudCreds | null>;
    getConvexAuthToken: () => Promise<ConvexAuthTokenResult | null>;
    syncDaemonSession: (creds: CloudCreds) => Promise<void>;
    stopDesktopDaemon: () => Promise<void>;
    clearCloudCreds: () => void;
    getAuthSessionGeneration: () => number;
    isAuthSessionGenerationCurrent: (generation: number) => boolean;
    invalidateAuthSession: () => void;
  }> = {},
) {
  const ipcMain = new FakeIpcMain();
  registerDesktopIpc({
    ipcMain: ipcMain as never,
    getLocalApiToken: () => 'local-token',
    loadCloudCreds: overrides.loadCloudCreds ?? (() => cloudCreds),
    loadModePref: () => null,
    saveModePref: () => undefined,
    refreshCloudSession: overrides.refreshCloudSession ?? (async () => cloudCreds),
    getConvexAuthToken: overrides.getConvexAuthToken ?? (async () => null),
    writeQaBootstrapEvidence: () => undefined,
    getSiteUrl: () => 'https://agendex.example',
    startDesktopAuthLogin: async () => ({
      state: 'state',
      createdAtMs: 1,
      expiresAtMs: 2,
      provider: 'github',
      callbackUrl: 'agendex://auth/callback',
    }),
    clearPendingDesktopAuthLogin: () => undefined,
    createPendingLoginCompletion: async () => true,
    clearCloudCreds: overrides.clearCloudCreds ?? (() => undefined),
    getAuthSessionGeneration: overrides.getAuthSessionGeneration ?? (() => 0),
    isAuthSessionGenerationCurrent: overrides.isAuthSessionGenerationCurrent ?? (() => true),
    invalidateAuthSession: overrides.invalidateAuthSession ?? (() => undefined),
    syncDaemonSession: overrides.syncDaemonSession ?? (async () => undefined),
    stopDesktopDaemon: overrides.stopDesktopDaemon ?? (async () => undefined),
    logLoginError: () => undefined,
  });
  return ipcMain;
}

test('login and refresh return without waiting for daemon startup', async () => {
  const daemonStart = deferred();
  const sessions: CloudCreds[] = [];
  const ipc = register({
    syncDaemonSession: (creds) => {
      sessions.push(creds);
      return daemonStart.promise;
    },
  });

  expect(await ipc.invoke('agendex:login', 'github')).toBe(true);
  expect(await ipc.invoke('agendex:refresh-cloud-session')).toEqual(cloudCreds);
  expect(sessions).toEqual([cloudCreds, cloudCreds]);
  daemonStart.resolve();
});

test('cleared refresh session stops the daemon', async () => {
  let stops = 0;
  const ipc = register({
    loadCloudCreds: () => null,
    refreshCloudSession: async () => null,
    stopDesktopDaemon: async () => {
      stops += 1;
    },
  });

  expect(await ipc.invoke('agendex:refresh-cloud-session')).toBeNull();
  expect(stops).toBe(1);
});

test('cleared Convex token session stops the daemon', async () => {
  let stops = 0;
  const ipc = register({
    loadCloudCreds: () => null,
    getConvexAuthToken: async () => null,
    stopDesktopDaemon: async () => {
      stops += 1;
    },
  });

  expect(await ipc.invoke('agendex:get-convex-auth-token')).toEqual({ sessionCleared: true });
  expect(stops).toBe(1);
});

test('logout invalidates auth work before daemon shutdown and credential clearing', async () => {
  const stopped = deferred();
  const events: string[] = [];
  const ipc = register({
    stopDesktopDaemon: async () => {
      events.push('stop-start');
      await stopped.promise;
      events.push('stop-end');
    },
    clearCloudCreds: () => events.push('clear'),
    invalidateAuthSession: () => events.push('invalidate'),
  });

  const logout = ipc.invoke('agendex:logout');
  await Promise.resolve();
  expect(events).toEqual(['invalidate', 'stop-start']);
  stopped.resolve();
  expect(await logout).toBe(true);
  expect(events).toEqual(['invalidate', 'stop-start', 'stop-end', 'clear']);
});

test('logout prevents an in-flight refresh from restarting the daemon', async () => {
  const refreshed = deferred<CloudCreds | null>();
  const stopped = deferred();
  let generation = 0;
  let starts = 0;
  const ipc = register({
    getAuthSessionGeneration: () => generation,
    isAuthSessionGenerationCurrent: (captured) => captured === generation,
    invalidateAuthSession: () => {
      generation += 1;
    },
    refreshCloudSession: () => refreshed.promise,
    syncDaemonSession: async () => {
      starts += 1;
    },
    stopDesktopDaemon: () => stopped.promise,
  });

  const refresh = ipc.invoke('agendex:refresh-cloud-session');
  const logout = ipc.invoke('agendex:logout');
  refreshed.resolve(cloudCreds);

  expect(await refresh).toBeNull();
  expect(starts).toBe(0);
  stopped.resolve();
  expect(await logout).toBe(true);
  expect(starts).toBe(0);
});
