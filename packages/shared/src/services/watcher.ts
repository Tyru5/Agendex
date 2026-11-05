import { existsSync, type FSWatcher, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { getActiveAdapters } from '../adapters/registry.ts';
import {
  discoverProjectPlanDirs,
  getCustomPlanDirs,
  pathsOverlapFilesystemTree,
  rescanFile,
} from './plan-service.ts';

type ChangeCallback = (plans: unknown[]) => void;

/**
 * One directory watched on behalf of one plan source. Two adapters may watch
 * the same directory with different matchers, so the key pairs the source with
 * the directory instead of keying on the directory alone.
 */
interface WatchTarget {
  key: string;
  dir: string;
  matches: (filePath: string) => boolean;
  sourcePath: (filePath: string) => string;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFiles = new Set<string>();
const activeWatchers = new Map<string, FSWatcher>();
// Watchers survive a refresh, so their listener resolves the matcher through
// this map rather than capturing one adapter instance for its whole lifetime.
const activeTargets = new Map<string, WatchTarget>();
let notifyPlansChanged: ChangeCallback | undefined;

function clearPendingRescan() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingFiles.clear();
}

/**
 * `FSWatcher.close()` blocks the calling thread on macOS: libuv hands the
 * FSEvents teardown to its CoreFoundation thread and parks the caller on a
 * semaphore (`uv__fsevents_close` -> `uv_sem_wait`) until that thread has
 * destroyed the shared FSEventStream and rebuilt it for the remaining handles.
 * Doing that once per watcher stalls the thread for seconds, and for minutes
 * when the handshake loses a wakeup. In Electron that thread is the browser
 * main thread, so the app stops pumping its run loop and macOS reports it as
 * "not responding".
 *
 * Only close a watcher when the process keeps running and would otherwise leak
 * it. On shutdown, drop the handle instead and let the kernel reclaim it.
 */
function closeWatcher(watcher: FSWatcher, dir: string) {
  try {
    watcher.close();
  } catch (err) {
    warnWatcherFailure('close watcher for', dir, err);
  }
}

function abandonWatcher(watcher: FSWatcher, dir: string) {
  try {
    watcher.removeAllListeners('change');
    // A watcher with no 'error' listener throws on the next filesystem hiccup.
    watcher.removeAllListeners('error');
    watcher.on('error', () => {});
    watcher.unref();
  } catch (err) {
    warnWatcherFailure('release watcher for', dir, err);
  }
}

/** (action, dir, code) triples already logged, so a failing dir warns once rather than per refresh. */
const warnedWatcherFailures = new Set<string>();

function warnWatcherFailure(action: string, dir: string, err: unknown) {
  const code =
    typeof err === 'object' && err !== null && typeof Reflect.get(err, 'code') === 'string'
      ? (Reflect.get(err, 'code') as string)
      : 'unknown';
  const key = `${action}\0${resolve(dir)}\0${code}`;
  if (warnedWatcherFailures.has(key)) return;
  warnedWatcherFailures.add(key);
  // ENOSPC / EMFILE here mean the OS watch limit is exhausted: changes in this
  // dir are only picked up by the periodic rescan.
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[agendex] could not ${action} ${dir} (${code}): ${message}`);
}

function flushPendingRescan() {
  debounceTimer = null;
  const files = [...pendingFiles];
  pendingFiles.clear();

  void (async () => {
    let allPlans: unknown[] = [];
    for (const file of files) {
      const plans = await rescanFile(file);
      allPlans = allPlans.concat(plans);
    }
    notifyPlansChanged?.(allPlans);
  })().catch((err) => {
    console.error('[agendex] failed to rescan changed plan files:', err);
  });
}

function startWatcher(target: WatchTarget) {
  if (!existsSync(target.dir)) return;
  try {
    const watcher = watch(target.dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const current = activeTargets.get(target.key);
      if (!current) return;
      const fullPath = join(current.dir, filename);
      if (!current.matches(fullPath)) return;

      pendingFiles.add(current.sourcePath(fullPath));
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flushPendingRescan, 300);
    });
    // An FSWatcher with no 'error' listener throws, and an errored watcher
    // never recovers. Forget it so the next refresh can attach a fresh one.
    // Abandon rather than close: the handle is already dead, and close() would
    // block the Electron main thread on macOS the same way shutdown used to.
    watcher.on('error', (err) => {
      if (activeWatchers.get(target.key) !== watcher) return;
      warnWatcherFailure('keep watching', target.dir, err);
      activeWatchers.delete(target.key);
      activeTargets.delete(target.key);
      abandonWatcher(watcher, target.dir);
    });
    activeWatchers.set(target.key, watcher);
    activeTargets.set(target.key, target);
    console.log(`[agendex] watching ${target.dir}`);
  } catch (err) {
    warnWatcherFailure('watch', target.dir, err);
  }
}

/**
 * `refreshDiscovered` walks `$HOME` for project plan dirs again; otherwise the
 * dirs found by the last full scan or watcher setup are reused.
 */
function collectWatchTargets(refreshDiscovered: boolean): WatchTarget[] {
  const adapters = getActiveAdapters();
  const targets: WatchTarget[] = [];
  const watchedPaths = new Set<string>();

  for (const adapter of adapters) {
    for (const watchPath of adapter.getWatchPaths()) {
      watchedPaths.add(resolve(watchPath));
      targets.push({
        key: `adapter:${adapter.agent}:${resolve(watchPath)}`,
        dir: watchPath,
        matches: (f) => adapter.matches(f, watchPath),
        sourcePath: (f) => adapter.getSourcePath?.(f) ?? f,
      });
    }
  }

  for (const { dir, agent } of discoverProjectPlanDirs({ useCache: !refreshDiscovered })) {
    if (watchedPaths.has(resolve(dir))) continue;
    const adapter = adapters.find((a) => a.agent === agent);
    if (!adapter) continue;
    watchedPaths.add(resolve(dir));
    targets.push({
      key: `project:${agent}:${resolve(dir)}`,
      dir,
      matches: (f) => adapter.matches(f, dir),
      sourcePath: (f) => adapter.getSourcePath?.(f) ?? f,
    });
  }

  for (const dir of getCustomPlanDirs()) {
    const resolvedCustom = resolve(dir);
    let overlaps = false;
    for (const watched of watchedPaths) {
      if (pathsOverlapFilesystemTree(resolvedCustom, watched)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    watchedPaths.add(resolvedCustom);
    targets.push({
      key: `custom:${resolvedCustom}`,
      dir,
      matches: (f) => f.endsWith('.md'),
      sourcePath: (f) => f,
    });
  }

  return targets;
}

/**
 * Attaches watchers for the current plan sources. Safe to call repeatedly:
 * watchers for unchanged sources are reused so a refresh does not pay the
 * per-watcher teardown cost described in closeWatcher.
 */
export function startWatching(onChange?: ChangeCallback) {
  notifyPlansChanged = onChange;
  const targets = collectWatchTargets(true);
  const desired = new Map(targets.map((target) => [target.key, target]));

  for (const [key, watcher] of activeWatchers) {
    if (desired.has(key)) continue;
    activeWatchers.delete(key);
    const dir = activeTargets.get(key)?.dir ?? key;
    activeTargets.delete(key);
    closeWatcher(watcher, dir);
  }

  for (const target of targets) {
    if (activeWatchers.has(target.key)) {
      // Adapters are re-resolved on every refresh; point the existing listener
      // at the fresh matcher.
      activeTargets.set(target.key, target);
      continue;
    }
    startWatcher(target);
  }
}

/**
 * Releases every watcher as part of process shutdown, without the blocking
 * `close()` handshake (see closeWatcher). Callers must be on their way out:
 * the handles stay open until the process exits.
 */
export function stopWatchingForShutdown() {
  clearPendingRescan();
  notifyPlansChanged = undefined;
  for (const [key, watcher] of activeWatchers) {
    abandonWatcher(watcher, activeTargets.get(key)?.dir ?? key);
  }
  activeWatchers.clear();
  activeTargets.clear();
}

/** Resolved filesystem paths the watcher would attach to (for refresh diffing). */
export function collectWatchPaths(): string[] {
  const paths = new Set(collectWatchTargets(false).map((target) => resolve(target.dir)));
  return [...paths].sort();
}
