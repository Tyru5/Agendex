import { watch } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { adapters } from '../adapters/registry.ts';
import { rescanFile } from './plan-service.ts';

type ChangeCallback = (plans: unknown[]) => void;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startWatching(onChange?: ChangeCallback) {
  for (const adapter of adapters) {
    for (const watchPath of adapter.getWatchPaths()) {
      if (!existsSync(watchPath)) continue;
      try {
        watch(watchPath, { recursive: true }, async (_event, filename) => {
          if (!filename) return;
          const fullPath = join(watchPath, filename);
          if (!adapter.matches(fullPath)) return;

          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            const plans = await rescanFile(fullPath);
            onChange?.(plans);
          }, 300);
        });
        console.log(`[planfig] watching ${watchPath}`);
      } catch {
        // dir doesn't exist or can't be watched
      }
    }
  }
}
