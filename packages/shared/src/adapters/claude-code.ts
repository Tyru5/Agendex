import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { getHomeDir } from '../home-dir.ts';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

function plansDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return join(configDir || join(getHomeDir(), '.claude'), 'plans');
}

function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)/m);
  if (match?.[1]) return match[1].replace(/^Plan:\s*/i, '').trim();
  return basename(filename, '.md')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Native session IDs are YAML scalar strings, which may be quoted. */
function sessionScalar(value: string): string | undefined {
  const scalar = value.trim();
  if (scalar.startsWith('"')) {
    const quoted = scalar.match(/^"(?:[^"\\]|\\.)*"(?=\s*(?:#|$))/)?.[0];
    if (!quoted) return undefined;
    try {
      const parsed: unknown = JSON.parse(quoted);
      return typeof parsed === 'string' ? parsed.trim() || undefined : undefined;
    } catch {
      return undefined;
    }
  }
  if (scalar.startsWith("'")) {
    const match = scalar.match(/^'((?:[^']|'')*)'(?=\s*(?:#|$))/);
    return match?.[1]?.replaceAll("''", "'").trim() || undefined;
  }
  return scalar.replace(/\s+#.*$/, '').trim() || undefined;
}

/** Every value for `key`: repeated keys must not hide a conflicting session ID. */
function frontmatterValues(content: string, key: string): string[] {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const frontmatter = fmMatch?.[1];
  if (!frontmatter) return [];

  const values: string[] = [];
  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    if (line.slice(0, separatorIndex).trim() !== key) continue;
    const value = sessionScalar(line.slice(separatorIndex + 1));
    if (value) values.push(value);
  }

  return values;
}

function stableFilenameSessionId(filePath: string): string | undefined {
  const stem = basename(filePath, '.md');
  if (/^(?:[0-9a-f]{8,}(?:-[0-9a-f]{4,})*|[0-9A-Z]{20,}|[a-z0-9_-]{16,})$/i.test(stem)) {
    return stem;
  }
  return undefined;
}

function extractMetadata(content: string, filePath: string): Record<string, unknown> {
  const explicitIds = ['sessionId', 'session_id', 'conversationId', 'conversation_id'].flatMap(
    (key) => frontmatterValues(content, key),
  );
  const sessionId = explicitIds[0];
  const id = sessionId ?? stableFilenameSessionId(filePath);
  return id
    ? {
        sessionId: id,
        sessionIdSource: 'claude-code',
        sessionIdOrigin:
          new Set(explicitIds).size > 1 ? 'ambiguous' : sessionId ? 'frontmatter' : 'filename',
      }
    : {};
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
