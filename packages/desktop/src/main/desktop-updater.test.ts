import { expect, test } from 'bun:test';
import { createDesktopUpdater, type UpdateState, type UpdaterLike } from './desktop-updater.ts';

interface FakeUpdater extends UpdaterLike {
  listeners: Map<string, ((...args: never[]) => void)[]>;
  emit: (event: string, payload?: unknown) => void;
  checkCalls: number;
  quitAndInstallCalls: number;
  checkResult: unknown;
  checkError: unknown;
}

function createFakeUpdater(): FakeUpdater {
  const fake: FakeUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    listeners: new Map(),
    checkCalls: 0,
    quitAndInstallCalls: 0,
    checkResult: null,
    checkError: null,
    on(event, listener) {
      const existing = fake.listeners.get(event) ?? [];
      existing.push(listener);
      fake.listeners.set(event, existing);
      return fake;
    },
    emit(event, payload) {
      for (const listener of fake.listeners.get(event) ?? []) {
        (listener as (arg: unknown) => void)(payload);
      }
    },
    async checkForUpdates() {
      fake.checkCalls += 1;
      if (fake.checkError) throw fake.checkError;
      return fake.checkResult;
    },
    quitAndInstall() {
      fake.quitAndInstallCalls += 1;
    },
  };
  return fake;
}

function noopTimer() {
  return { unref: () => undefined };
}

test('does nothing when the app is not packaged', () => {
  const updater = createFakeUpdater();
  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: false,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  desktopUpdater.start();

  expect(desktopUpdater.isSupported).toBe(false);
  expect(updater.checkCalls).toBe(0);
  expect(updater.listeners.size).toBe(0);
});

test('start schedules an initial delayed check and periodic re-checks', () => {
  const updater = createFakeUpdater();
  let initialCheck: (() => void) | undefined;
  let periodicCheck: (() => void) | undefined;

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    setTimeoutFn: (fn: () => void) => {
      initialCheck = fn;
      return noopTimer();
    },
    setIntervalFn: (fn: () => void) => {
      periodicCheck = fn;
      return noopTimer();
    },
  });

  desktopUpdater.start();
  // Second start must not double-schedule.
  desktopUpdater.start();

  expect(updater.autoDownload).toBe(true);
  expect(updater.autoInstallOnAppQuit).toBe(true);

  initialCheck?.();
  periodicCheck?.();
  expect(updater.checkCalls).toBe(2);
});

test('check failures are logged and do not throw', async () => {
  const updater = createFakeUpdater();
  updater.checkError = new Error('network down');
  const logged: string[] = [];
  let scheduled: (() => void) | undefined;

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: (message) => logged.push(message),
    setTimeoutFn: (fn: () => void) => {
      scheduled = fn;
      return noopTimer();
    },
    setIntervalFn: () => noopTimer(),
  });

  desktopUpdater.start();
  scheduled?.();
  await Bun.sleep(0);

  expect(logged.includes('auto-update check failed')).toBe(true);
});

test('update-downloaded prompts and installs when the user accepts', async () => {
  const updater = createFakeUpdater();
  let promptedVersion = '';

  createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async ({ version }) => {
      promptedVersion = version;
      return { restartNow: true };
    },
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  updater.emit('update-downloaded', { version: '2.0.0' });
  await Bun.sleep(0);

  expect(promptedVersion).toBe('2.0.0');
  expect(updater.quitAndInstallCalls).toBe(1);
});

test('update-downloaded does not install when the user declines, and re-prompts on a later download', async () => {
  const updater = createFakeUpdater();
  let prompts = 0;

  createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => {
      prompts += 1;
      return { restartNow: false };
    },
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  updater.emit('update-downloaded', { version: '2.0.0' });
  await Bun.sleep(0);
  updater.emit('update-downloaded', { version: '2.0.1' });
  await Bun.sleep(0);

  expect(prompts).toBe(2);
  expect(updater.quitAndInstallCalls).toBe(0);
});

test('concurrent update-downloaded events only prompt once', async () => {
  const updater = createFakeUpdater();
  let prompts = 0;
  let resolvePrompt: ((result: { restartNow: boolean }) => void) | undefined;

  createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: () =>
      new Promise((resolve) => {
        prompts += 1;
        resolvePrompt = resolve;
      }),
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  updater.emit('update-downloaded', { version: '2.0.0' });
  updater.emit('update-downloaded', { version: '2.0.0' });
  expect(prompts).toBe(1);

  resolvePrompt?.({ restartNow: false });
  await Bun.sleep(0);
});

test('updater errors are logged and do not crash', () => {
  const updater = createFakeUpdater();
  const logged: string[] = [];

  createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: (message) => logged.push(message),
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  updater.emit('error', new Error('feed unreachable'));

  expect(logged.includes('auto-update error')).toBe(true);
});

test('interactive check reports up-to-date and dedupes concurrent checks', async () => {
  const updater = createFakeUpdater();
  updater.checkResult = { isUpdateAvailable: false, updateInfo: { version: '1.3.0' } };
  let upToDateVersion = '';

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    notifyUpToDate: ({ version }) => {
      upToDateVersion = version;
    },
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  await Promise.all([
    desktopUpdater.checkForUpdatesInteractive(),
    desktopUpdater.checkForUpdatesInteractive(),
  ]);

  expect(updater.checkCalls).toBe(1);
  expect(upToDateVersion).toBe('1.3.0');
});

test('interactive check stays silent when an update is available', async () => {
  const updater = createFakeUpdater();
  updater.checkResult = { isUpdateAvailable: true, updateInfo: { version: '2.0.0' } };
  let notified = false;

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    notifyUpToDate: () => {
      notified = true;
    },
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  await desktopUpdater.checkForUpdatesInteractive();

  expect(notified).toBe(false);
});

test('onStateChange fires for each update event with correct state', async () => {
  const updater = createFakeUpdater();
  const states: UpdateState[] = [];

  createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    onStateChange: (state) => states.push(state),
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  updater.emit('checking-for-update');
  updater.emit('update-available', { version: '2.0.0' });
  updater.emit('download-progress', { percent: 50 });
  updater.emit('update-downloaded', { version: '2.0.0' });

  expect(states).toEqual([
    { status: 'checking' },
    { status: 'downloading', version: '2.0.0' },
    { status: 'downloading', version: '2.0.0', progress: 50 },
    { status: 'ready', version: '2.0.0' },
  ]);
});

test('onStateChange fires no-update when update-not-available', () => {
  const updater = createFakeUpdater();
  const states: UpdateState[] = [];

  createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    onStateChange: (state) => states.push(state),
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  updater.emit('update-not-available');

  expect(states).toEqual([{ status: 'no-update' }]);
});

test('onStateChange fires error state with message', () => {
  const updater = createFakeUpdater();
  const states: UpdateState[] = [];

  createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    onStateChange: (state) => states.push(state),
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  updater.emit('error', new Error('feed unreachable'));

  expect(states).toEqual([{ status: 'error', error: 'feed unreachable' }]);
});

test('getState returns the current state', () => {
  const updater = createFakeUpdater();

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  expect(desktopUpdater.getState()).toEqual({ status: 'idle' });

  updater.emit('checking-for-update');
  expect(desktopUpdater.getState()).toEqual({ status: 'checking' });

  updater.emit('update-available', { version: '2.0.0' });
  expect(desktopUpdater.getState()).toEqual({ status: 'downloading', version: '2.0.0' });

  updater.emit('update-downloaded', { version: '2.0.0' });
  expect(desktopUpdater.getState()).toEqual({ status: 'ready', version: '2.0.0' });
});

test('checkForUpdates triggers a check and dedupes concurrent calls', async () => {
  const updater = createFakeUpdater();
  updater.checkResult = { isUpdateAvailable: false, updateInfo: { version: '1.0.0' } };

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  await Promise.all([desktopUpdater.checkForUpdates(), desktopUpdater.checkForUpdates()]);

  expect(updater.checkCalls).toBe(1);
});

test('checkForUpdates does not call notifyUpToDate', async () => {
  const updater = createFakeUpdater();
  updater.checkResult = { isUpdateAvailable: false, updateInfo: { version: '1.0.0' } };
  let notified = false;

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    notifyUpToDate: () => {
      notified = true;
    },
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  await desktopUpdater.checkForUpdates();

  expect(notified).toBe(false);
});

test('quitAndInstall delegates to the updater', () => {
  const updater = createFakeUpdater();

  const desktopUpdater = createDesktopUpdater({
    updater,
    isPackaged: true,
    promptToRestart: async () => ({ restartNow: false }),
    log: () => undefined,
    setTimeoutFn: () => noopTimer(),
    setIntervalFn: () => noopTimer(),
  });

  desktopUpdater.quitAndInstall();

  expect(updater.quitAndInstallCalls).toBe(1);
});
