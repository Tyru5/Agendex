import { watch } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { getActiveAdapters } from '../adapters/registry.ts';
import { rescanFile } from './plan-service.ts';

type ChangeCallback = (plans: unknown[]) => void;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFiles = new Set<string>();

export function startWatching(onChange?: ChangeCallback) {
  const adapters = getActiveAdapters();
  for (const adapter of adapters) {
    for (const watchPath of adapter.getWatchPaths()) {
      if (!existsSync(watchPath)) continue;
      try {
        watch(watchPath, { recursive: true }, async (_event, filename) => {
          if (!filename) return;
          const fullPath = join(watchPath, filename);
          if (!adapter.matches(fullPath)) return;

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
        console.log(`[agendex] watching ${watchPath}`);
      } catch {
        // dir doesn't exist or can't be watched
      }
    }
  }
}
