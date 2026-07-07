import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

const cursorProjectsDir = join(homedir(), '.cursor', 'projects');

function discoverCursorPlanDirs(): string[] {
  if (!existsSync(cursorProjectsDir)) return [];

  const dirs: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(cursorProjectsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const trustedFile = join(cursorProjectsDir, entry, '.workspace-trusted');
    if (!existsSync(trustedFile)) continue;

    try {
      const raw = JSON.parse(readFileSync(trustedFile, 'utf-8')) as {
        workspacePath?: string;
      };
      if (!raw.workspacePath) continue;

      const plansDir = join(raw.workspacePath, '.cursor', 'plans');
      if (existsSync(plansDir)) {
        dirs.push(plansDir);
      }
    } catch {
      // skip unreadable entries
    }
  }

  return dirs;
}

function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)/m);
  if (match?.[1]) return match[1].replace(/^Plan:\s*/i, '').trim();
  return basename(filename, '.plan.md')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function stripFrontmatter(raw: string): { body: string; metadata: Record<string, unknown> } {
  const text = raw.replace(/^<!--\s*[\w-]+\s*-->\s*\n?/, '');

  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!fmMatch) return { body: text.trim(), metadata: {} };

  const metadata: Record<string, unknown> = {};
  const fmBody = fmMatch[1] ?? '';

  const todoIdMatches = fmBody.match(/^\s+-\s+id:\s/gm);
  if (todoIdMatches) {
    metadata.todoCount = todoIdMatches.length;
  }

  const projectMatch = fmBody.match(/^isProject:\s*(.+)$/m);
  if (projectMatch?.[1]) {
    metadata.isProject = projectMatch[1].trim() === 'true';
  }

  const stableIdMatch = fmBody.match(/^(?:id|planId|sessionId|sourceId):\s*(.+)$/m);
  if (stableIdMatch?.[1]) {
    metadata.sessionId = stableIdMatch[1].trim();
  }

  const body = text.slice(fmMatch[0].length).trim();
  return { body, metadata };
}

function workspaceFromPlanPath(filePath: string): string | undefined {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.indexOf('/.cursor/plans/');
  if (idx === -1) return undefined;
  return filePath.slice(0, idx);
}

export const cursorAdapter: AgentAdapter = {
  agent: 'cursor',
  writable: false,

  getSearchPaths() {
    return discoverCursorPlanDirs();
  },

  getWatchPaths() {
    return discoverCursorPlanDirs();
  },

  matches(filePath: string) {
    return filePath.endsWith('.plan.md');
  },

  async parse(filePath: string): Promise<Plan[]> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const stats = await stat(filePath);
      const { body, metadata } = stripFrontmatter(raw);

      return [
        {
          id: hashPath(filePath),
          agent: 'cursor',
          title: extractTitle(body, filePath),
          content: body,
          filePath,
          format: 'md',
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
          workspace: workspaceFromPlanPath(filePath),
          metadata,
        },
      ];
    } catch {
      return [];
    }
  },

  async write(): Promise<boolean> {
    return false;
  },
};
