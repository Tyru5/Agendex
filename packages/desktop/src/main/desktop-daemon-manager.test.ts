import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';

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

  postMessage(message: unknown): void {
    this.messages.push(message);
    if ((message as { type?: string }).type === 'start') {
      queueMicrotask(() => this.emit('message', { type: 'ready', pid: this.pid }));
    }
    if ((message as { type?: string }).type === 'shutdown') {
      queueMicrotask(() => {
        this.pid = undefined;
        this.emit('exit', 0);
      });
    }
  }

  kill(): boolean {
    this.killed = true;
    this.pid = undefined;
    this.emit('exit', 1);
    return true;
  }
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
  const forkCalls: Array<{ path: string; options: { env?: NodeJS.ProcessEnv } }> = [];
  const manager = new DesktopDaemonManager({
    isDev: true,
    workerEntry: join(tempRoot, 'worker path with spaces', 'daemon-worker.js'),
    forkWorker: ((path: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      forkCalls.push({ path, options });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }) as never,
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  const credentials = { token: 'desktop-secret', convexSiteUrl: 'https://example.convex.site' };
  const [first, second] = await Promise.all([
    manager.ensureRunning(credentials),
    manager.ensureRunning(credentials),
  ]);

  expect(first).toBe('started');
  expect(second).toBe('started');
  expect(forkCalls).toHaveLength(1);
  expect(forkCalls[0]?.path).toContain('worker path with spaces');
  expect(forkCalls[0]?.options.env?.AGENDEX_DEV).toBe('1');
  expect(forkCalls[0]?.options.env?.AGENDEX_CLOUD_TOKEN).toBeUndefined();
  expect(
    child.messages.some(
      (message) =>
        JSON.stringify(message) ===
        JSON.stringify({ type: 'start', credentials, parentPid: process.pid }),
    ),
  ).toBe(true);

  await manager.stop();
  expect(child.messages.some((message) => JSON.stringify(message) === '{"type":"shutdown"}')).toBe(
    true,
  );
});

test('reuses a live external daemon and never forks or stops it', async () => {
  useTempConfigDir();
  mkdirSync(process.env.AGENDEX_CONFIG_DIR as string, { recursive: true });
  writeFileSync(
    join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.pid'),
    JSON.stringify({ pid: process.pid, launcher: 'cli' }),
  );
  let forks = 0;
  const manager = new DesktopDaemonManager({
    isDev: false,
    forkWorker: (() => {
      forks += 1;
      return new FakeUtilityProcess();
    }) as never,
    rotateCloudToken: () => null,
    onAuthExpired: () => undefined,
    log: () => undefined,
  });

  expect(
    await manager.ensureRunning({
      token: 'desktop-secret',
      convexSiteUrl: 'https://example.convex.site',
    }),
  ).toBe('already-running');
  await manager.stop();
  expect(forks).toBe(0);
});

test('development worker coordination does not collide with the production PID namespace', async () => {
  useTempHomeWithoutOverride();
  mkdirSync(join(tempRoot, '.agendex'), { recursive: true });
  writeFileSync(
    join(tempRoot, '.agendex', 'daemon.pid'),
    JSON.stringify({ pid: process.pid, launcher: 'cli' }),
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
      token: 'desktop-secret',
      convexSiteUrl: 'http://127.0.0.1:3211',
    }),
  ).toBe('started');
  expect(forks).toBe(1);
  await manager.stop();
});
