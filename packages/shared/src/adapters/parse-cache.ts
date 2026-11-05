import type { AgentAdapter } from '../types.ts';
import { claudeCodeAdapter } from './claude-code.ts';
import { codexCliAdapter } from './codex-cli.ts';
import { cursorAdapter } from './cursor.ts';
import { openCodeAdapter } from './opencode.ts';

/**
 * Files whose (size, mtime) fully determine `adapter.parse(sourcePath)`, so an
 * unchanged fingerprint lets a full scan reuse the previous result.
 *
 * Returns undefined for every other adapter: they also read sibling metadata
 * (`summary.json`, session indexes), list directories, or probe live
 * processes, none of which a per-file fingerprint captures, so they are always
 * re-parsed. SQLite sources include the `-wal`/`-shm` files because committed
 * rows can live only in the write-ahead log. T3 Code is not cached: it picks
 * each plan's workspace by checking whether its worktree still exists on disk.
 */
export function getParseCacheDependencies(
  adapter: AgentAdapter,
  sourcePath: string,
): string[] | undefined {
  if (adapter === claudeCodeAdapter || adapter === codexCliAdapter || adapter === cursorAdapter) {
    return [sourcePath];
  }
  if (adapter === openCodeAdapter) {
    return [sourcePath, `${sourcePath}-wal`, `${sourcePath}-shm`];
  }
  return undefined;
}
