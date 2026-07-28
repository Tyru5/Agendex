import { EventEmitter } from 'node:events';
import * as nodeFs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { AgentAdapter, Plan } from '../types.ts';

class FakeWatcher extends EventEmitter {
  closed = false;
  unrefed = false;
  /** Mimics the blocking `uv__fsevents_close` handshake macOS pays per handle. */
  closeStallMs = 0;

  close() {
    this.closed = true;
    const until = Date.now() + this.closeStallMs;
    while (Date.now() < until) {
      // Busy-wait: `close()` blocks the thread, it does not yield to the loop.
    }
  }

  unref() {
    this.unrefed = true;
    return this;
  }
}

let createdWatchers: FakeWatcher[] = [];
let watchStallMsForNewWatchers = 0;
let activeAdapters: AgentAdapter[] = [];
let projectPlanDirs: Array<{ dir: string; agent: string }> = [];
let customPlanDirs: string[] = [];

mock.module('node:fs', () => ({
  ...nodeFs,
  default: nodeFs,
  watch: (dir: string, _options: unknown, listener: (...args: unknown[]) => void) => {
    const watcher = new FakeWatcher();
    watcher.closeStallMs = watchStallMsForNewWatchers;
    watcher.on('change', listener);
    Object.defineProperty(watcher, 'watchedDir', { value: dir });
    createdWatchers.push(watcher);
    return watcher;
  },
}));

mock.module('../adapters/registry.ts', () => ({
  getActiveAdapters: () => activeAdapters,
}));

mock.module('./plan-service.ts', () => ({
  discoverProjectPlanDirs: () => projectPlanDirs,
  getCustomPlanDirs: () => customPlanDirs,
  pathsOverlapFilesystemTree: () => false,
  rescanFile: async () => [] as Plan[],
}));

function watchedDirOf(watcher: FakeWatcher): string {
  return Reflect.get(watcher, 'watchedDir') as string;
}

function fakeAdapter(agent: string, watchPaths: string[]): AgentAdapter {
  return {
    agent,
    getSearchPaths: () => watchPaths,
    getWatchPaths: () => watchPaths,
    matches: (filePath: string) => filePath.endsWith('.md'),
    parse: async () => [],
    write: async () => true,
    writable: true,
  };
}

let tempRoot = '';

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'agendex-watcher-test-'));
  createdWatchers = [];
  watchStallMsForNewWatchers = 0;
  activeAdapters = [];
  projectPlanDirs = [];
  customPlanDirs = [];
});

afterEach(async () => {
  const { stopWatchingForShutdown } = await import('./watcher.ts');
  stopWatchingForShutdown();
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeDir(name: string): string {
  const dir = join(tempRoot, name);
  nodeFs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('shutdown releases watchers without paying the blocking close handshake', async () => {
  const { startWatching, stopWatchingForShutdown } = await import('./watcher.ts');
  watchStallMsForNewWatchers = 100;
  activeAdapters = [
    fakeAdapter(
      'claude-code',
      Array.from({ length: 20 }, (_, index) => makeDir(`source-${index}`)),
    ),
  ];

  startWatching(() => undefined);
  expect(createdWatchers).toHaveLength(20);

  const startedAt = Date.now();
  stopWatchingForShutdown();
  const elapsed = Date.now() - startedAt;

  // Closing all 20 sequentially would stall the thread for ~2s; the whole point
  // is that shutdown never blocks the Electron main thread.
  expect(elapsed < 200).toBe(true);
  expect(createdWatchers.some((watcher) => watcher.closed)).toBe(false);
  expect(createdWatchers.every((watcher) => watcher.unrefed)).toBe(true);
  expect(createdWatchers.every((watcher) => watcher.listenerCount('change') === 0)).toBe(true);
});

test('abandoned watchers keep an error listener so a late failure cannot throw', async () => {
  const { startWatching, stopWatchingForShutdown } = await import('./watcher.ts');
  activeAdapters = [fakeAdapter('claude-code', [makeDir('plans')])];

  startWatching(() => undefined);
  stopWatchingForShutdown();

  const watcher = createdWatchers[0];
  expect(watcher).toBeDefined();
  expect(() => watcher?.emit('error', new Error('watch failed'))).not.toThrow();
});

test('refreshing reuses watchers for unchanged sources', async () => {
  const { startWatching } = await import('./watcher.ts');
  activeAdapters = [fakeAdapter('claude-code', [makeDir('a'), makeDir('b')])];

  startWatching(() => undefined);
  startWatching(() => undefined);

  expect(createdWatchers).toHaveLength(2);
  expect(createdWatchers.some((watcher) => watcher.closed)).toBe(false);
});

test('refreshing closes only watchers whose source went away', async () => {
  const { startWatching } = await import('./watcher.ts');
  const kept = makeDir('kept');
  const dropped = makeDir('dropped');
  activeAdapters = [fakeAdapter('claude-code', [kept, dropped])];

  startWatching(() => undefined);
  activeAdapters = [fakeAdapter('claude-code', [kept])];
  startWatching(() => undefined);

  const closed = createdWatchers.filter((watcher) => watcher.closed).map(watchedDirOf);
  expect(closed).toEqual([dropped]);
  expect(createdWatchers).toHaveLength(2);
});

test('a watcher that errors is dropped and replaced on the next refresh', async () => {
  const { startWatching } = await import('./watcher.ts');
  watchStallMsForNewWatchers = 100;
  activeAdapters = [fakeAdapter('claude-code', [makeDir('plans')])];

  startWatching(() => undefined);
  const failed = createdWatchers[0];
  expect(failed).toBeDefined();

  const startedAt = Date.now();
  expect(() => failed?.emit('error', new Error('watch failed'))).not.toThrow();
  expect(Date.now() - startedAt < 50).toBe(true);
  expect(failed?.closed).toBe(false);
  expect(failed?.unrefed).toBe(true);

  startWatching(() => undefined);

  expect(createdWatchers).toHaveLength(2);
});

test('refreshing attaches watchers for newly added sources', async () => {
  const { startWatching } = await import('./watcher.ts');
  const existing = makeDir('existing');
  activeAdapters = [fakeAdapter('claude-code', [existing])];

  startWatching(() => undefined);
  const added = makeDir('added');
  customPlanDirs = [added];
  startWatching(() => undefined);

  expect(createdWatchers.map(watchedDirOf)).toEqual([existing, added]);
  expect(createdWatchers.some((watcher) => watcher.closed)).toBe(false);
});

test('two adapters watching the same directory each keep their own watcher', async () => {
  const { startWatching } = await import('./watcher.ts');
  const shared = makeDir('shared');
  activeAdapters = [fakeAdapter('opencode', [shared]), fakeAdapter('oh-my-opencode', [shared])];

  startWatching(() => undefined);

  expect(createdWatchers).toHaveLength(2);
});

test('a reused watcher reports changes through the latest callback', async () => {
  const { startWatching } = await import('./watcher.ts');
  const dir = makeDir('plans');
  activeAdapters = [fakeAdapter('claude-code', [dir])];

  startWatching(() => undefined);
  let notified = false;
  startWatching(() => {
    notified = true;
  });

  expect(createdWatchers).toHaveLength(1);
  createdWatchers[0]?.emit('change', 'change', 'plan.md');
  await Bun.sleep(400);

  expect(notified).toBe(true);
});
