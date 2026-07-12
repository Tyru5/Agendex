import { readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

function plansDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(configDir || join(home, '.claude'), 'plans');
}

function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)/m);
  if (match?.[1]) return match[1].replace(/^Plan:\s*/i, '').trim();
  return basename(filename, '.md')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function frontmatterValue(content: string, key: string): string | undefined {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const frontmatter = fmMatch?.[1];
  if (!frontmatter) return undefined;

  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    if (line.slice(0, separatorIndex).trim() !== key) continue;
    return line.slice(separatorIndex + 1).trim() || undefined;
  }

  return undefined;
}

function stableFilenameSessionId(filePath: string): string | undefined {
  const stem = basename(filePath, '.md');
  if (/^(?:[0-9a-f]{8,}(?:-[0-9a-f]{4,})*|[0-9A-Z]{20,}|[a-z0-9_-]{16,})$/i.test(stem)) {
    return stem;
  }
  return undefined;
}

function extractMetadata(content: string, filePath: string): Record<string, unknown> {
  const sessionId =
    frontmatterValue(content, 'sessionId') ??
    frontmatterValue(content, 'session_id') ??
    frontmatterValue(content, 'conversationId') ??
    frontmatterValue(content, 'conversation_id') ??
    stableFilenameSessionId(filePath);

  return sessionId ? { sessionId, sessionIdSource: 'claude-code' } : {};
}

export const claudeCodeAdapter: AgentAdapter = {
  agent: 'claude-code',
  writable: true,

  getSearchPaths() {
    return [plansDir()];
  },

  getWatchPaths() {
    return [plansDir()];
  },

  matches(filePath: string) {
    if (!filePath.endsWith('.md')) return false;
    const normalized = resolve(filePath);
    const baseDir = resolve(plansDir());
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
          metadata: extractMetadata(content, filePath),
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
