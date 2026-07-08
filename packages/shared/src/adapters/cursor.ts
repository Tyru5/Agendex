import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { hashPath } from '../hash.ts';
import { normalizeSyncPath } from '../services/plan-sync-identity.ts';
import type { AgentAdapter, Plan } from '../types.ts';

function getRuntimeHomeDir(): string {
  if (process.env.HOME) return process.env.HOME;
  if (process.env.USERPROFILE) return process.env.USERPROFILE;
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`;
  }
  return homedir();
}

function getCursorProjectsDir(): string {
  return join(getRuntimeHomeDir(), '.cursor', 'projects');
}

function getGlobalCursorPlansDir(): string {
  return join(getRuntimeHomeDir(), '.cursor', 'plans');
}

function isGlobalCursorPlanPath(filePath: string): boolean {
  const normalizedFile = normalizeSyncPath(filePath);
  const normalizedGlobal = normalizeSyncPath(getGlobalCursorPlansDir());
  return normalizedFile === normalizedGlobal || normalizedFile.startsWith(`${normalizedGlobal}/`);
}

function discoverCursorPlanDirs(): string[] {
  const dirs = new Set<string>();

  const globalPlansDir = getGlobalCursorPlansDir();
  if (existsSync(globalPlansDir)) {
    dirs.add(resolve(globalPlansDir));
  }

  const cursorProjectsDir = getCursorProjectsDir();
  if (!existsSync(cursorProjectsDir)) return [...dirs];

  let entries: string[];
  try {
    entries = readdirSync(cursorProjectsDir);
  } catch {
    return [...dirs];
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
        dirs.add(resolve(plansDir));
      }
    } catch {
      // skip unreadable entries
    }
  }

  return [...dirs];
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
  const metadata: Record<string, unknown> = {};
  let text = raw;

  const commentMatch = text.match(/^<!--\s*([\w-]+)\s*-->\s*\n?/);
  if (commentMatch?.[1]) {
    metadata.sessionId = commentMatch[1];
    text = text.slice(commentMatch[0].length);
  }

  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!fmMatch) return { body: text.trim(), metadata };
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
  if (isGlobalCursorPlanPath(filePath)) return undefined;

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
      const isGlobalPlan = isGlobalCursorPlanPath(filePath);

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
          metadata: isGlobalPlan
            ? {
                ...metadata,
                source: 'global-cursor',
                userPlansDir: getGlobalCursorPlansDir(),
              }
            : metadata,
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
