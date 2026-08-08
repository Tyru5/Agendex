import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
import { DesktopBackendManager } from './desktop-backend-manager.ts';

class FakeBackendProcess extends EventEmitter {
  pid: number | undefined = 52_000;
  stdout = null;
  stderr = null;
  readonly messages: unknown[] = [];
  killed = false;

  constructor(
    private readonly behavior: {
      listenOnStart?: boolean;
      exitOnShutdown?: boolean;
      exitOnKill?: boolean;
      failClientDirUpdate?: boolean;
    } = {},
  ) {
    super();
  }

  postMessage(message: unknown): void {
    if (
      (message as { type?: string }).type === 'set-client-dist-dir' &&
      this.behavior.failClientDirUpdate
    ) {
      throw new Error('IPC channel closed');
    }
    this.messages.push(message);
    if ((message as { type?: string }).type === 'start' && this.behavior.listenOnStart !== false) {
      queueMicrotask(() =>
        this.emit('message', { type: 'listening', port: 49_001, token: 'local-token' }),
      );
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

  exit(code: number): void {
    if (this.pid === undefined) return;
    this.pid = undefined;
    this.emit('exit', code);
  }
}

function startOptions() {
  return { port: 0, hostname: 'localhost', clientDistDir: 'C:\\Agendex\\client' };
}

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(1);
  expect(predicate()).toBe(true);
}

// Users should see the shell immediately while a slow WSL plan scan continues off-thread.
test('desktop backend resolves when listening while indexing continues', async () => {
  const child = new FakeBackendProcess();
  const states: string[] = [];
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({ AGENDEX_HOME: '\\\\wsl.localhost\\Ubuntu\\home\\ty' }),
    onStateChange: (state) => states.push(state.status),
    log: () => undefined,
  });

  await expect(manager.start(startOptions())).resolves.toEqual({
    port: 49_001,
    token: 'local-token',
  });
  expect(manager.getState()).toEqual({ status: 'indexing' });
  expect(child.killed).toBe(false);

  child.emit('message', { type: 'index-ready' });
  expect(manager.getState()).toEqual({ status: 'ready' });
  manager.setClientDistDir('C:\\Agendex\\updated-client');
  expect(child.messages).toContainEqual({
    type: 'set-client-dist-dir',
    clientDistDir: 'C:\\Agendex\\updated-client',
  });
  expect(states).toEqual(['starting', 'indexing', 'ready']);
  await manager.stop();
});

// A boot-time UI quarantine must win even if it lands after fork but before the child spawns.
test('desktop backend starts with the latest client directory', async () => {
  const child = new FakeBackendProcess();
  let emitSpawn: (() => void) | undefined;
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      emitSpawn = () => child.emit('spawn');
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    log: () => undefined,
  });

  const starting = manager.start(startOptions());
  manager.setClientDistDir('C:\\Agendex\\quarantined-fallback');
  emitSpawn?.();
  await starting;

  expect(child.messages).toContainEqual({
    type: 'start',
    port: 0,
    hostname: 'localhost',
    clientDistDir: 'C:\\Agendex\\quarantined-fallback',
    parentPid: process.pid,
  });
  await manager.stop();
});

// A failed rollback message must replace the worker instead of serving a quarantined bundle.
test('desktop backend recovers when a client directory update cannot be delivered', async () => {
  const children = [
    new FakeBackendProcess({ failClientDirUpdate: true }),
    new FakeBackendProcess(),
  ];
  let forks = 0;
  let restored = false;
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      const child = children[forks++];
      if (!child) throw new Error('Unexpected backend fork');
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    restartDelayMs: 1,
    onConnectionRestored: () => {
      restored = true;
    },
    log: () => undefined,
  });

  await manager.start(startOptions());
  manager.setClientDistDir('C:\\Agendex\\safe-client');
  await waitFor(() => restored);

  expect(children[0]?.killed).toBe(true);
  expect(children[1]?.messages).toContainEqual({
    type: 'start',
    port: 0,
    hostname: 'localhost',
    clientDistDir: 'C:\\Agendex\\safe-client',
    parentPid: process.pid,
  });
  await manager.stop();
});

// A wedged backend bootstrap must fail promptly instead of leaving Electron waiting forever.
test('desktop backend still times out when the utility process never listens', async () => {
  const child = new FakeBackendProcess({ listenOnStart: false });
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    startTimeoutMs: 5,
    log: () => undefined,
  });

  await expect(manager.start(startOptions())).rejects.toThrow('Timed out starting');
  expect(child.killed).toBe(true);
  await manager.stop();
});

// Quitting during API bootstrap must release every startup waiter before Electron exits.
test('desktop backend stop settles an in-flight startup', async () => {
  const child = new FakeBackendProcess({ listenOnStart: false });
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    log: () => undefined,
  });

  const starting = manager.start(startOptions());
  const outcome = starting.then(
    () => null,
    (error: unknown) => error,
  );
  await Promise.resolve();
  await manager.stop();

  expect(await outcome).toEqual(
    expect.objectContaining({ message: 'Agendex local API startup was cancelled' }),
  );
  expect(manager.getState()).toEqual({ status: 'idle' });
});

// Restarting Electron must wait for forced backend termination after graceful shutdown stalls.
test('desktop backend stop waits for forced termination', async () => {
  const child = new FakeBackendProcess({ exitOnShutdown: false });
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    stopTimeoutMs: 2,
    killTimeoutMs: 10,
    log: () => undefined,
  });

  await manager.start(startOptions());
  await manager.stop();

  expect(child.killed).toBe(true);
  expect(manager.getState()).toEqual({ status: 'idle' });
});

// A relaunch must not create a second backend while the first one is still shutting down.
test('desktop backend rejects starts during shutdown', async () => {
  const child = new FakeBackendProcess({ exitOnShutdown: false });
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    stopTimeoutMs: 2,
    killTimeoutMs: 10,
    log: () => undefined,
  });

  await manager.start(startOptions());
  const stopping = manager.stop();
  const startOutcome = manager.start(startOptions()).then(
    () => null,
    (error: unknown) => error,
  );

  expect(await startOutcome).toEqual(
    expect.objectContaining({ message: 'Agendex local API shutdown is in progress' }),
  );
  await stopping;
  expect(child.killed).toBe(true);
});

// A backend crash must reconnect the existing desktop to a fresh worker and current UI bundle.
test('desktop backend restores its connection and latest client directory after indexing fails', async () => {
  const children = [new FakeBackendProcess(), new FakeBackendProcess()];
  let forks = 0;
  let restored: { port: number; token: string } | null = null;
  const errors: string[] = [];
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      const child = children[forks++];
      if (!child) throw new Error('Unexpected backend fork');
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    restartDelayMs: 1,
    onUnexpectedExit: (error) => errors.push(error.message),
    onConnectionRestored: (connection) => {
      restored = connection;
    },
    log: () => undefined,
  });

  await manager.start(startOptions());
  manager.setClientDistDir('C:\\Agendex\\safe-client');
  children[0]?.emit('message', {
    type: 'fatal',
    phase: 'indexing',
    message: 'Initial plan scan failed',
  });

  await waitFor(() => restored !== null);
  expect(forks).toBe(2);
  expect(children[0]?.killed).toBe(true);
  expect(errors).toEqual(['Initial plan scan failed']);
  expect(children[1]?.messages).toContainEqual({
    type: 'start',
    port: 0,
    hostname: 'localhost',
    clientDistDir: 'C:\\Agendex\\safe-client',
    parentPid: process.pid,
  });
  await manager.stop();
});

// Recovery should survive a transient replacement failure rather than abandoning the open window.
test('desktop backend keeps retrying until a replacement listens', async () => {
  const children = [
    new FakeBackendProcess(),
    new FakeBackendProcess({ listenOnStart: false }),
    new FakeBackendProcess(),
  ];
  let forks = 0;
  let restored = false;
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      const index = forks++;
      const child = children[index];
      if (!child) throw new Error('Unexpected backend fork');
      queueMicrotask(() => {
        child.emit('spawn');
        if (index === 1) queueMicrotask(() => child.exit(2));
      });
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    restartDelayMs: 1,
    onConnectionRestored: () => {
      restored = true;
    },
    log: () => undefined,
  });

  await manager.start(startOptions());
  children[0]?.exit(1);
  await waitFor(() => restored);

  expect(forks).toBe(3);
  await manager.stop();
});

// Quitting after a crash must cancel recovery so no orphan backend is launched behind Electron.
test('desktop backend stop cancels a pending automatic restart', async () => {
  const child = new FakeBackendProcess();
  let forks = 0;
  const manager = new DesktopBackendManager({
    workerEntry: 'backend-worker.js',
    forkWorker: (() => {
      forks += 1;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    getWorkerEnv: () => ({}),
    restartDelayMs: 20,
    log: () => undefined,
  });

  await manager.start(startOptions());
  child.exit(1);
  await manager.stop();
  await Bun.sleep(30);

  expect(forks).toBe(1);
  expect(manager.getState()).toEqual({ status: 'idle' });
});
