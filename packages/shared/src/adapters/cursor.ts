import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

const _dbPath = join(homedir(), '.cursor', 'ai-tracking', 'ai-code-tracking.db');

export const cursorAdapter: AgentAdapter = {
  agent: 'cursor',
  writable: false,

  getSearchPaths() {
    return [join(homedir(), '.cursor', 'ai-tracking')];
  },

  getWatchPaths() {
    return [join(homedir(), '.cursor', 'ai-tracking')];
  },

  matches(filePath: string) {
    return filePath.endsWith('.db');
  },

  async parse(filePath: string): Promise<Plan[]> {
    if (!existsSync(filePath)) return [];

    try {
      const db = new Database(filePath, { readonly: true });
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>;

      const plans: Plan[] = [];
      const stats = await stat(filePath);

      for (const table of tables) {
        try {
          const rows = db.query(`SELECT * FROM "${table.name}" LIMIT 50`).all() as Record<
            string,
            unknown
          >[];
          if (rows.length === 0) continue;

          const content = rows
            .map((row) => {
              return Object.entries(row)
                .map(([k, v]) => `**${k}**: ${String(v)}`)
                .join('\n');
            })
            .join('\n\n---\n\n');

          plans.push({
            id: hashPath(`${filePath}:${table.name}`),
            agent: 'cursor',
            title: `Cursor: ${table.name}`,
            content,
            filePath,
            format: 'sqlite',
            createdAt: stats.birthtime,
            updatedAt: stats.mtime,
            metadata: { table: table.name },
          });
        } catch {
          // skip tables that can't be read
        }
      }

      db.close();
      return plans;
    } catch {
      return [];
    }
  },

  async write(): Promise<boolean> {
    return false;
  },
};
