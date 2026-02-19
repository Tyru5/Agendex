import { existsSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { getActiveAdapters } from '../adapters/registry.ts';
import { discoverProjectPlanDirs, rescanFile } from './plan-service.ts';

type ChangeCallback = (plans: unknown[]) => void;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFiles = new Set<string>();

function watchDir(dir: string, matchFn: (f: string) => boolean, onChange?: ChangeCallback) {
  if (!existsSync(dir)) return;
  try {
    watch(dir, { recursive: true }, async (_event, filename) => {
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
    console.log(`[agendex] watching ${dir}`);
  } catch {}
}

export function startWatching(onChange?: ChangeCallback) {
  const adapters = getActiveAdapters();
  const watchedPaths = new Set<string>();

  for (const adapter of adapters) {
    for (const watchPath of adapter.getWatchPaths()) {
      watchedPaths.add(resolve(watchPath));
      watchDir(watchPath, (f) => adapter.matches(f), onChange);
    }
  }

  const discovered = discoverProjectPlanDirs();
  for (const { dir, agent } of discovered) {
    if (watchedPaths.has(resolve(dir))) continue;
    const adapter = adapters.find((a) => a.agent === agent);
    if (!adapter) continue;
    watchDir(dir, (f) => adapter.matches(f), onChange);
  }
}
