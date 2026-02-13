import { homedir } from 'os';
import { join, basename, resolve, sep } from 'path';
import { stat, readdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import type { AgentAdapter, Plan } from './types.ts';

const plansDir = join(homedir(), '.claude', 'plans');

function hashPath(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)/m);
  if (match?.[1]) return match[1].replace(/^Plan:\s*/i, '').trim();
  return basename(filename, '.md')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const claudeCodeAdapter: AgentAdapter = {
  agent: 'claude-code',
  writable: true,

  getSearchPaths() {
    return [plansDir];
  },

  getWatchPaths() {
    return [plansDir];
  },

  matches(filePath: string) {
    if (!filePath.endsWith('.md')) return false;
    const normalized = resolve(filePath);
    const baseDir = resolve(plansDir);
    return normalized.startsWith(baseDir + sep);
  },

  async parse(filePath: string): Promise<Plan[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const stats = await stat(filePath);
      return [
        {
          id: hashPath(filePath),
          agent: 'claude-code',
          title: extractTitle(content, filePath),
          content,
          filePath,
          format: 'md',
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
          metadata: {},
        },
      ];
    } catch {
      return [];
    }
  },

  async write(plan: Plan, newContent: string): Promise<boolean> {
    try {
      await writeFile(plan.filePath, newContent, 'utf-8');
      return true;
    } catch {
      return false;
    }
  },
};
