import type { AgentAdapter } from '../types.ts';
import { claudeCodeAdapter } from './claude-code.ts';
import { codexCliAdapter } from './codex-cli.ts';
import { cursorAdapter } from './cursor.ts';
import { openCodeAdapter } from './opencode.ts';
import { t3CodeAdapter } from './t3-code.ts';

/**
 * Files whose (size, mtime) fully determine `adapter.parse(sourcePath)`, so an
 * unchanged fingerprint lets a full scan reuse the previous result.
 *
 * Returns undefined for every other adapter: they also read sibling metadata
 * (`summary.json`, session indexes), list directories, or probe live
 * processes, none of which a per-file fingerprint captures, so they are always
 * re-parsed. SQLite sources include the `-wal`/`-shm` files because committed
 * rows can live only in the write-ahead log.
 */
export function getParseCacheDependencies(
  adapter: AgentAdapter,
  sourcePath: string,
): string[] | undefined {
  if (adapter === claudeCodeAdapter || adapter === codexCliAdapter || adapter === cursorAdapter) {
    return [sourcePath];
  }
  if (adapter === openCodeAdapter || adapter === t3CodeAdapter) {
    return [sourcePath, `${sourcePath}-wal`, `${sourcePath}-shm`];
  }
  return undefined;
}
