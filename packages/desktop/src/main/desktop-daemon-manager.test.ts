import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { acquireDaemonStartLock, getDaemonBootId } from '@agendex/daemon-runtime';

const { DesktopDaemonManager } = await import('./desktop-daemon-manager.ts');

const originalConfigDir = process.env.AGENDEX_CONFIG_DIR;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempRoot = '';

class FakeUtilityProcess extends EventEmitter {
  pid: number | undefined = 41_424;
  stdout = null;
  stderr = null;
  readonly messages: unknown[] = [];
  killed = false;

  constructor(
    private readonly behavior: {
      bootOnStart?: boolean;
      readyOnStart?: boolean;
      exitOnShutdown?: boolean;
      exitOnKill?: boolean;
    } = {},
  ) {
    super();
  }

  exit(code: number): void {
    if (this.pid === undefined) return;
    this.pid = undefined;
    this.emit('exit', code);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
    if ((message as { type?: string }).type === 'start') {
      if (this.behavior.bootOnStart !== false) {
        queueMicrotask(() => this.emit('message', { type: 'booted', pid: this.pid }));
      }
      if (this.behavior.readyOnStart !== false) {
        queueMicrotask(() => this.emit('message', { type: 'ready', pid: this.pid }));
      }
    }
    if (
      (message as { type?: string }).type === 'shutdown' &&
      this.behavior.exitOnShutdown !== false
    ) {
      queueMicrotask(() => this.exit(0));
    }
  }

  kill(): boolean {
    this.killed = true;
    if (this.behavior.exitOnKill !== false) this.exit(1);
    return true;
  }
}

function credentials(token = 'desktop-secret') {
  return { token, convexSiteUrl: 'https://example.convex.site' };
}

function testTimings() {
  return {
    startTimeoutMs: 50,
    stopTimeoutMs: 5,
    killTimeoutMs: 20,
    orphanGraceMs: 5,
    contentionWaitMs: 5,
    restartDelayMs: 5,
    externalStatePollMs: 2,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(1);
  expect(predicate()).toBe(true);
}

function useTempConfigDir(name = 'agendex daemon manager ') {
  tempRoot = mkdtempSync(join(tmpdir(), name));
  process.env.AGENDEX_CONFIG_DIR = join(tempRoot, '.agendex');
}

function useTempHomeWithoutOverride() {
  tempRoot = mkdtempSync(join(tmpdir(), 'agendex daemon home '));
  delete process.env.AGENDEX_CONFIG_DIR;
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
}

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalConfigDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

test('starts one utility worker without putting credentials in its environment', async () => {
  useTempConfigDir('agendex daemon path with spaces ');
  const child = new FakeUtilityProcess();
  const forkCalls: Array<{
    path: string;
    args: string[];
    options: { env?: NodeJS.ProcessEnv; execArgv?: string[] };
  }> = [];
  const manager = new DesktopDaemonManager({
    isDev: true,
    workerEntry: join(tempRoot, 'worker path with spaces', 'daemon-worker.js'),
    forkWorker: ((
      path: string,
      args: string[],
      options: { env?: NodeJS.ProcessEnv; execArgv?: string[] },
    ) => {
      forkCalls.push({ path, args, options });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  const session = credentials();
  const [first, second] = await Promise.all([
    manager.ensureRunning(session),
    manager.ensureRunning(session),
  ]);

  expect(first).toBe('started');
  expect(second).toBe('started');
  expect(forkCalls).toHaveLength(1);
  expect(forkCalls[0]?.path).toContain('worker path with spaces');
  expect(forkCalls[0]?.args).toEqual(['--agendex-daemon-worker']);
  expect(forkCalls[0]?.options.env?.AGENDEX_DEV).toBe('1');
  expect(forkCalls[0]?.options.env?.AGENDEX_CLOUD_TOKEN).toBeUndefined();
  expect(forkCalls[0]?.options.execArgv).toBeUndefined();
  expect(
    child.messages.some(
      (message) =>
        JSON.stringify(message) ===
        JSON.stringify({ type: 'start', credentials: session, parentPid: process.pid }),
    ),
  ).toBe(true);

  await manager.stop();
  expect(child.messages.some((message) => JSON.stringify(message) === '{"type":"shutdown"}')).toBe(
    true,
  );
});

// Desktop users relying on an existing CLI daemon should see indexing become ready without restarting.
test('tracks readiness for a live external daemon without taking ownership', async () => {
  useTempConfigDir();
  const configDir = process.env.AGENDEX_CONFIG_DIR as string;
  mkdirSync(configDir, { recursive: true });
  const pidPath = join(configDir, 'daemon.pid');
  writeFileSync(
    pidPath,
    JSON.stringify({
      pid: process.pid,
      launcher: 'cli',
      bootId: getDaemonBootId(),
      ready: false,
    }),
  );
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      forks += 1;
      return new FakeUtilityProcess();
    }) as never,
    isDaemonProcess: () => true,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  expect(await manager.ensureRunning(credentials())).toBe('already-running');
  expect(manager.getState()).toEqual({
    status: 'indexing',
    message: 'Another Agendex process is indexing plans',
  });
  writeFileSync(
    pidPath,
    JSON.stringify({
      pid: process.pid,
      launcher: 'cli',
      bootId: getDaemonBootId(),
      ready: true,
    }),
  );
  await waitFor(() => manager.getState().status === 'ready');
  await manager.stop();
  expect(forks).toBe(0);
});

// If an external CLI dies while indexing, the signed-in desktop should take over synchronization.
test('replaces an external daemon that stops before becoming ready', async () => {
  useTempConfigDir();
  const configDir = process.env.AGENDEX_CONFIG_DIR as string;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'daemon.pid'),
    JSON.stringify({
      pid: process.pid,
      launcher: 'cli',
      bootId: getDaemonBootId(),
      ready: false,
    }),
  );
  let externalAlive = true;
  let forks = 0;
  const child = new FakeUtilityProcess();
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      forks += 1;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    isProcessRunning: (pid) => (pid === process.pid ? externalAlive : true),
    isDaemonProcess: (pid) => pid === process.pid && externalAlive,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  expect(await manager.ensureRunning(credentials())).toBe('already-running');
  externalAlive = false;
  await waitFor(() => manager.getState().status === 'ready');

  expect(forks).toBe(1);
  expect(manager.getState()).toEqual({ status: 'ready' });
  await manager.stop();
});

// A CLI daemon that crashes after readiness must not leave the desktop reporting stale health.
test('replaces an external daemon that stops after becoming ready', async () => {
  useTempConfigDir();
  const configDir = process.env.AGENDEX_CONFIG_DIR as string;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'daemon.pid'),
    JSON.stringify({
      pid: process.pid,
      launcher: 'cli',
      bootId: getDaemonBootId(),
      ready: true,
    }),
  );
  let externalAlive = true;
  let forks = 0;
  const child = new FakeUtilityProcess();
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      forks += 1;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    isProcessRunning: (pid) => (pid === process.pid ? externalAlive : true),
    isDaemonProcess: (pid) => pid === process.pid && externalAlive,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  expect(await manager.ensureRunning(credentials())).toBe('already-running');
  expect(manager.getState()).toEqual({ status: 'ready' });
  externalAlive = false;
  await waitFor(() => forks === 1 && manager.getState().status === 'ready');

  expect(manager.getState()).toEqual({ status: 'ready' });
  await manager.stop();
});

test('starts a worker when a stale cross-host PID was reused by a live process', async () => {
  useTempConfigDir();
  mkdirSync(process.env.AGENDEX_CONFIG_DIR as string, { recursive: true });
  writeFileSync(
    join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.pid'),
    JSON.stringify({
      pid: process.pid,
      launcher: 'cli',
      bootId: getDaemonBootId(),
      hostname: 'another-host.invalid',
      startedAtMs: Date.now(),
    }),
  );
  const child = new FakeUtilityProcess();
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      forks += 1;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  expect(await manager.ensureRunning(credentials())).toBe('started');
  expect(forks).toBe(1);
  await manager.stop();
});

test('re-evaluates PID state after a concurrent lock holder finishes stopping', async () => {
  useTempConfigDir();
  const configDir = process.env.AGENDEX_CONFIG_DIR as string;
  mkdirSync(configDir, { recursive: true });
  const pidPath = join(configDir, 'daemon.pid');
  writeFileSync(
    pidPath,
    JSON.stringify({ pid: process.pid, launcher: 'cli', bootId: getDaemonBootId() }),
  );
  const release = acquireDaemonStartLock({ configDir });
  expect(typeof release).toBe('function');
  const child = new FakeUtilityProcess();
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      forks += 1;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    isDaemonProcess: () => true,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  const starting = manager.ensureRunning(credentials());
  setTimeout(() => {
    rmSync(pidPath, { force: true });
    release?.();
  }, 5);

  expect(await starting).toBe('started');
  expect(forks).toBe(1);
  await manager.stop();
});

test('development worker coordination does not collide with the production PID namespace', async () => {
  useTempHomeWithoutOverride();
  mkdirSync(join(tempRoot, '.agendex'), { recursive: true });
  writeFileSync(
    join(tempRoot, '.agendex', 'daemon.pid'),
    JSON.stringify({ pid: process.pid, launcher: 'cli', bootId: getDaemonBootId() }),
  );
  const child = new FakeUtilityProcess();
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: true,
    forkWorker: (() => {
      forks += 1;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  expect(
    await manager.ensureRunning({
      ...credentials(),
      convexSiteUrl: 'http://127.0.0.1:3211',
    }),
  ).toBe('started');
  expect(forks).toBe(1);
  await manager.stop();
});

test('stop during orphan grace cancels startup before forking', async () => {
  useTempConfigDir();
  mkdirSync(process.env.AGENDEX_CONFIG_DIR as string, { recursive: true });
  writeFileSync(
    join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.pid'),
    JSON.stringify({
      pid: 80_001,
      launcher: 'desktop',
      parentPid: 80_002,
      bootId: getDaemonBootId(),
    }),
  );
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      forks += 1;
      return new FakeUtilityProcess();
    }) as never,
    isProcessRunning: (pid) => pid === 80_001,
    isDaemonProcess: (pid) => pid === 80_001,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  const starting = manager.ensureRunning(credentials());
  const stopping = manager.stop();
  let startError: unknown;
  try {
    await starting;
  } catch (error) {
    startError = error;
  }
  await stopping;

  expect(startError instanceof Error).toBe(true);
  expect(forks).toBe(0);
});

// Quitting during worker boot must not leave a hidden sync process behind.
test('stop cancels an owned worker that has not acknowledged boot', async () => {
  useTempConfigDir();
  const child = new FakeUtilityProcess({ bootOnStart: false, readyOnStart: false });
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    timings: { ...testTimings(), startTimeoutMs: 5_000 },
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  const starting = manager.ensureRunning(credentials());
  await Promise.resolve();
  const startedAt = Date.now();
  await manager.stop();

  expect(child.killed).toBe(true);
  expect(Date.now() - startedAt < 500).toBe(true);
  await expect(starting).rejects.toThrow('Daemon startup was cancelled');
});

// A failed worker launch must surface immediately so the desktop can retry it.
test('rejects when a worker exits before acknowledging boot', async () => {
  useTempConfigDir();
  const child = new FakeUtilityProcess({ bootOnStart: false, readyOnStart: false });
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      queueMicrotask(() => {
        child.emit('spawn');
        queueMicrotask(() => child.exit(2));
      });
      return child;
    }) as never,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  let startError: unknown;
  try {
    await manager.ensureRunning(credentials());
  } catch (error) {
    startError = error;
  }

  expect(startError instanceof Error).toBe(true);
  expect(String(startError)).toContain('exited before startup');
  await manager.stop();
});

// A wedged worker must be terminated instead of freezing desktop startup indefinitely.
test('kills and rejects a worker that never acknowledges boot', async () => {
  useTempConfigDir();
  const child = new FakeUtilityProcess({ bootOnStart: false, readyOnStart: false });
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    timings: { ...testTimings(), startTimeoutMs: 5 },
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  let startError: unknown;
  try {
    await manager.ensureRunning(credentials());
  } catch (error) {
    startError = error;
  }

  expect(startError instanceof Error).toBe(true);
  expect(String(startError)).toContain('Timed out waiting');
  expect(child.killed).toBe(true);
  await manager.stop();
});

// WSL users with slow UNC scans must keep one healthy daemon past the boot deadline.
test('does not apply the boot timeout to a slow initial plan scan', async () => {
  useTempConfigDir();
  const child = new FakeUtilityProcess({ readyOnStart: false });
  const states: string[] = [];
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    timings: { ...testTimings(), startTimeoutMs: 5 },
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    onStateChange: (state) => states.push(state.status),
    log: () => undefined,
  });

  await expect(manager.ensureRunning(credentials())).resolves.toBe('started');
  child.emit('message', {
    type: 'status',
    status: 'indexing',
    message: 'Scanning plan folders',
  });
  await Bun.sleep(15);

  expect(child.killed).toBe(false);
  expect(manager.getState()).toEqual({ status: 'indexing', message: 'Scanning plan folders' });
  expect(states).toContain('indexing');
  await manager.stop();
});

// A transient utility-process launch failure should recover without user intervention.
test('automatically retries a transient pre-boot worker failure', async () => {
  useTempConfigDir();
  const children = [
    new FakeUtilityProcess({ bootOnStart: false, readyOnStart: false }),
    new FakeUtilityProcess(),
  ];
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      const child = children[forks];
      forks += 1;
      if (!child) throw new Error('Unexpected fork');
      queueMicrotask(() => {
        child.emit('spawn');
        if (forks === 1) queueMicrotask(() => child.exit(2));
      });
      return child;
    }) as never,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  try {
    await manager.ensureRunning(credentials());
  } catch {}
  await Bun.sleep(15);

  expect(forks).toBe(2);
  expect(
    children[1]?.messages.some((message) => (message as { type?: string }).type === 'start'),
  ).toBe(true);
  await manager.stop();
});

test('forces termination when graceful shutdown does not exit', async () => {
  useTempConfigDir();
  const child = new FakeUtilityProcess({ exitOnShutdown: false });
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  await manager.ensureRunning(credentials());
  await manager.stop();

  expect(child.killed).toBe(true);
});

test('holds the lifecycle lock until its owned worker exits', async () => {
  useTempConfigDir();
  const configDir = process.env.AGENDEX_CONFIG_DIR as string;
  const child = new FakeUtilityProcess({ exitOnShutdown: false });
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  await manager.ensureRunning(credentials());
  const stopping = manager.stop();
  await Promise.resolve();
  expect(acquireDaemonStartLock({ configDir })).toBeNull();
  child.exit(0);
  await stopping;

  const release = acquireDaemonStartLock({ configDir });
  expect(typeof release).toBe('function');
  release?.();
});

test('uses the newest credentials when they change during startup', async () => {
  useTempConfigDir();
  const child = new FakeUtilityProcess();
  let emitSpawn: (() => void) | undefined;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      emitSpawn = () => child.emit('spawn');
      return child;
    }) as never,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  const first = manager.ensureRunning(credentials('old-token'));
  const second = manager.ensureRunning(credentials('new-token'));
  emitSpawn?.();
  await Promise.all([first, second]);

  expect(
    child.messages.some(
      (message) =>
        JSON.stringify(message) ===
        JSON.stringify({
          type: 'start',
          credentials: credentials('new-token'),
          parentPid: process.pid,
        }),
    ),
  ).toBe(true);
  await manager.stop();
});

test('handles worker auth events without crashing the manager', async () => {
  useTempConfigDir();
  const child = new FakeUtilityProcess();
  const expiredTokens: string[] = [];
  const logs: string[] = [];
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    timings: testTimings(),
    rotateCloudToken: () => {
      throw new Error('storage unavailable');
    },
    onAuthExpired: (token) => {
      expiredTokens.push(token);
    },
    log: (message) => logs.push(message),
  });

  await manager.ensureRunning(credentials());
  child.emit('message', { type: 'token-rotated', previousToken: 'old', token: 'new' });
  child.emit('message', { type: 'auth-expired', failedToken: 'failed-token' });
  await Promise.resolve();

  expect(expiredTokens).toEqual(['failed-token']);
  expect(logs).toContain('Failed to persist a rotated cloud token');
  await manager.stop();
});

test('automatically starts a replacement after an unexpected post-ready exit', async () => {
  useTempConfigDir();
  const children = [new FakeUtilityProcess(), new FakeUtilityProcess()];
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      const child = children[forks];
      forks += 1;
      if (!child) throw new Error('Unexpected fork');
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    timings: testTimings(),
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  await manager.ensureRunning(credentials());
  children[0]?.exit(1);
  await Bun.sleep(15);
  expect(forks).toBe(2);
  expect(
    children[1]?.messages.some((message) => (message as { type?: string }).type === 'start'),
  ).toBe(true);
  await manager.stop();
});
