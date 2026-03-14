import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

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

    let db: Database.Database | null = null;
    try {
      const { default: SqliteDatabase } = await import('better-sqlite3');
      db = new SqliteDatabase(filePath, { fileMustExist: true, readonly: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;

      const plans: Plan[] = [];
      const stats = await stat(filePath);

      for (const table of tables) {
        try {
          const rows = db
            .prepare(`SELECT * FROM ${quoteIdentifier(table.name)} LIMIT 50`)
            .all() as Record<string, unknown>[];
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

      return plans;
    } catch {
      return [];
    } finally {
      db?.close();
    }
  },

  async write(): Promise<boolean> {
    return false;
  },
};
