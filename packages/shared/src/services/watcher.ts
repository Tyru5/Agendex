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

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFiles = new Set<string>();
const activeWatchers: FSWatcher[] = [];

function closeAllWatchers() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingFiles.clear();
  for (const watcher of activeWatchers) {
    try {
      watcher.close();
    } catch {}
  }
  activeWatchers.length = 0;
}

function watchDir(dir: string, matchFn: (f: string) => boolean, onChange?: ChangeCallback) {
  if (!existsSync(dir)) return;
  try {
    const watcher = watch(dir, { recursive: true }, async (_event, filename) => {
      if (!filename) return;
      const fullPath = join(dir, filename);
      if (!matchFn(fullPath)) return;

      pendingFiles.add(fullPath);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const files = [...pendingFiles];
        pendingFiles.clear();
        let allPlans: unknown[] = [];
        for (const file of files) {
          const plans = await rescanFile(file);
          allPlans = allPlans.concat(plans);
        }
        onChange?.(allPlans);
      }, 300);
    });
    activeWatchers.push(watcher);
    console.log(`[agendex] watching ${dir}`);
  } catch {}
}

export function startWatching(onChange?: ChangeCallback) {
  closeAllWatchers();
  setupWatchers(onChange);
}

export function stopWatching() {
  closeAllWatchers();
}

/** Resolved filesystem paths the watcher would attach to (for refresh diffing). */
export function collectWatchPaths(): string[] {
  const adapters = getActiveAdapters();
  const watchedPaths = new Set<string>();

  for (const adapter of adapters) {
    for (const watchPath of adapter.getWatchPaths()) {
      watchedPaths.add(resolve(watchPath));
    }
  }

  const discovered = discoverProjectPlanDirs();
  for (const { dir, agent } of discovered) {
    if (watchedPaths.has(resolve(dir))) continue;
    const adapter = adapters.find((a) => a.agent === agent);
    if (!adapter) continue;
    watchedPaths.add(resolve(dir));
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
  }

  return [...watchedPaths].sort();
}

function setupWatchers(onChange?: ChangeCallback) {
  const adapters = getActiveAdapters();
  const watchedPaths = new Set<string>();

  for (const adapter of adapters) {
    for (const watchPath of adapter.getWatchPaths()) {
      watchedPaths.add(resolve(watchPath));
      watchDir(watchPath, (f) => adapter.matches(f, watchPath), onChange);
    }
  }

  const discovered = discoverProjectPlanDirs();
  for (const { dir, agent } of discovered) {
    if (watchedPaths.has(resolve(dir))) continue;
    const adapter = adapters.find((a) => a.agent === agent);
    if (!adapter) continue;
    watchedPaths.add(resolve(dir));
    watchDir(dir, (f) => adapter.matches(f, dir), onChange);
  }

  const customDirs = getCustomPlanDirs();
  for (const dir of customDirs) {
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
    watchDir(dir, (f) => f.endsWith('.md'), onChange);
  }
}
