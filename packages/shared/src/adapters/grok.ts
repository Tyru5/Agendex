import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

function getRuntimeHomeDir(): string {
  if (process.env.HOME) return process.env.HOME;
  if (process.env.USERPROFILE) return process.env.USERPROFILE;
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`;
  }
  return homedir();
}

function getSessionsDir(): string {
  return join(getRuntimeHomeDir(), '.grok', 'sessions');
}

interface GrokSummary {
  sessionId?: string;
  workspace?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  branch?: string;
  commit?: string;
  model?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function readSummary(planPath: string): Promise<GrokSummary> {
  const summary: GrokSummary = {};
  try {
    const raw = await readFile(join(dirname(planPath), 'summary.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return summary;

    const info = isRecord(parsed.info) ? parsed.info : undefined;

    summary.sessionId = asString(info?.id) ?? asString(parsed.id);
    summary.workspace = asString(info?.cwd) ?? asString(parsed.git_root_dir);
    summary.title = asString(parsed.session_summary) ?? asString(parsed.generated_title);
    summary.createdAt = asString(parsed.created_at);
    summary.updatedAt = asString(parsed.updated_at);
    summary.branch = asString(parsed.head_branch);
    summary.commit = asString(parsed.head_commit);
    summary.model = asString(parsed.current_model_id);
  } catch {
    // summary.json is optional; fall back to file stats + plan body.
  }
  return summary;
}

function headingTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)/m);
  if (!match?.[1]) return undefined;
  return match[1].replace(/^Plan:\s*/i, '').trim() || undefined;
}

function prettifyId(sessionId: string): string {
  return sessionId
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export const grokAdapter: AgentAdapter = {
  agent: 'grok',
  writable: false,

  getSearchPaths() {
    return [getSessionsDir()];
  },

  getWatchPaths() {
    return [getSessionsDir()];
  },

  matches(filePath: string) {
    if (basename(filePath) !== 'plan.md') return false;
    const normalized = resolve(filePath);
    const baseDir = resolve(getSessionsDir());
    return normalized.startsWith(baseDir + sep);
  },

  async parse(filePath: string): Promise<Plan[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      if (!content.trim()) return [];

      const stats = await stat(filePath);
      const summary = await readSummary(filePath);

      const sessionId = summary.sessionId ?? basename(dirname(filePath));
      const title =
        headingTitle(content) ?? summary.title ?? (sessionId ? prettifyId(sessionId) : 'Grok Plan');

      const createdAt = parseDate(summary.createdAt) ?? stats.birthtime;
      const updatedAt = parseDate(summary.updatedAt) ?? stats.mtime;

      const metadata: Record<string, unknown> = {};
      if (sessionId) {
        metadata.sessionId = sessionId;
        metadata.sessionIdSource = 'grok';
      }
      if (summary.branch) metadata.branch = summary.branch;
      if (summary.commit) metadata.commit = summary.commit;
      if (summary.model) metadata.model = summary.model;

      return [
        {
          id: hashPath(filePath),
          agent: 'grok',
          title,
          content,
          filePath,
          format: 'md',
          createdAt,
          updatedAt,
          workspace: summary.workspace,
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
