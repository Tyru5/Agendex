import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { getHomeDir } from '../home-dir.ts';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

/**
 * omp (oh-my-pi) plan-mode adapter.
 *
 * omp stores sessions as append-only JSONL files under
 * `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl` and keeps
 * each session's plan-mode draft as a plain Markdown artifact next to it:
 * `<session-file-minus-.jsonl>/local/<slug>-plan.md` (older sessions use
 * `local/PLAN.md`). See https://omp.sh/docs/plan and
 * https://omp.sh/docs/session-format.
 */
function getSessionsDirs(): string[] {
  const dirs: string[] = [];

  // omp's own overrides, honored so an indexer sees the same paths omp writes.
  const sessionDirOverride = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDirOverride) dirs.push(resolve(sessionDirOverride));

  const agentDirOverride = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDirOverride) dirs.push(join(resolve(agentDirOverride), 'sessions'));

  // XDG redirection flattens the agent/ prefix: $XDG_DATA_HOME/omp/sessions.
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) dirs.push(join(resolve(xdgDataHome), 'omp', 'sessions'));

  dirs.push(join(getHomeDir(), '.omp', 'agent', 'sessions'));

  return [...new Set(dirs)];
}

interface OmpSessionMeta {
  sessionId?: string;
  workspace?: string;
  title?: string;
  createdAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isPlanArtifactName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower === 'plan.md' || lower.endsWith('-plan.md');
}

function isSessionFile(filePath: string): boolean {
  return basename(filePath).toLowerCase().endsWith('.jsonl');
}

function isUnderSessionsRoot(filePath: string, scanRoot?: string): boolean {
  const normalized = resolve(filePath);
  const roots = scanRoot ? [...getSessionsDirs(), scanRoot] : getSessionsDirs();
  return roots.some((root) => normalized.startsWith(resolve(root) + sep));
}

/** `<sessions>/<cwd>/<stem>/local/<name>-plan.md` → `<sessions>/<cwd>/<stem>.jsonl` */
function sessionFileForPlan(planPath: string): string {
  return `${dirname(dirname(resolve(planPath)))}.jsonl`;
}

function sessionFileForSource(filePath: string): string {
  return isSessionFile(filePath) ? resolve(filePath) : sessionFileForPlan(filePath);
}

async function planFilesForSource(filePath: string): Promise<string[]> {
  if (!isSessionFile(filePath)) return [filePath];

  const sessionFile = resolve(filePath);
  const sessionStem = basename(sessionFile).replace(/\.jsonl$/i, '');
  const localDir = join(dirname(sessionFile), sessionStem, 'local');
  try {
    const names = await readdir(localDir);
    return names.filter(isPlanArtifactName).map((name) => join(localDir, name));
  } catch {
    return [];
  }
}

/**
 * Read the session title slot and header from the first lines of the session
 * JSONL file. Entries are append-only, so the header is always near the top.
 */
async function readSessionMeta(planPath: string): Promise<OmpSessionMeta> {
  const meta: OmpSessionMeta = {};
  try {
    const raw = await readFile(sessionFileForPlan(planPath), 'utf-8');
    for (const line of raw.split('\n').slice(0, 5)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      if (parsed.type === 'title') {
        meta.title ??= asString(parsed.title);
      } else if (parsed.type === 'session') {
        meta.sessionId = asString(parsed.id);
        meta.workspace = asString(parsed.cwd);
        meta.title ??= asString(parsed.title);
        meta.createdAt = asString(parsed.timestamp);
        break;
      }
    }
  } catch {
    // The session file is optional metadata; fall back to file stats.
  }
  return meta;
}

function headingTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)/m);
  if (!match?.[1]) return undefined;
  return match[1].replace(/^Plan:\s*/i, '').trim() || undefined;
}

/** `auth-storage-plan.md` → `Auth Storage` */
function slugTitle(planPath: string): string | undefined {
  const stem = basename(planPath).replace(/\.md$/i, '');
  const slug = stem.replace(/-?plan$/i, '');
  if (!slug) return undefined;
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Session filenames look like `<timestamp>_<sessionId>.jsonl`. */
function sessionIdFromPath(planPath: string): string | undefined {
  const stem = basename(dirname(dirname(resolve(planPath))));
  const separator = stem.indexOf('_');
  if (separator < 0) return undefined;
  return stem.slice(separator + 1) || undefined;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

async function parsePlanArtifact(filePath: string): Promise<Plan | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    if (!content.trim()) return null;

    const stats = await stat(filePath);
    const meta = await readSessionMeta(filePath);
    const sessionId = meta.sessionId ?? sessionIdFromPath(filePath);

    const title = headingTitle(content) ?? meta.title ?? slugTitle(filePath) ?? 'omp Plan';

    const metadata: Record<string, unknown> = {
      sourcePaths: [sessionFileForPlan(filePath)],
    };
    if (sessionId) {
      metadata.sessionId = sessionId;
      metadata.sessionIdSource = 'omp';
    }

    return {
      id: hashPath(filePath),
      agent: 'omp',
      title,
      content,
      filePath,
      format: 'md',
      createdAt: parseDate(meta.createdAt) ?? stats.birthtime,
      updatedAt: stats.mtime,
      workspace: meta.workspace,
      metadata,
    };
  } catch {
    return null;
  }
}

export const ompAdapter: AgentAdapter = {
  agent: 'omp',
  writable: true,

  getSearchPaths() {
    return getSessionsDirs();
  },

  getWatchPaths() {
    return getSessionsDirs();
  },

  getCreatePath(slug: string, timestamp: number) {
    const sessionsDir = getSessionsDirs()[0] ?? join(getHomeDir(), '.omp', 'agent', 'sessions');
    const sessionStem = `${timestamp}_agendex-${timestamp}`;
    const fileName = slug.endsWith('-plan') ? `${slug}.md` : `${slug}-plan.md`;
    return join(sessionsDir, '-agendex', sessionStem, 'local', fileName);
  },

  getSourcePath(filePath: string) {
    return sessionFileForSource(filePath);
  },

  matches(filePath: string, scanRoot?: string) {
    if (isSessionFile(filePath)) return isUnderSessionsRoot(filePath, scanRoot);
    if (!isPlanArtifactName(basename(filePath))) return false;
    if (basename(dirname(filePath)) !== 'local') return false;
    return isUnderSessionsRoot(filePath, scanRoot);
  },

  async parse(filePath: string): Promise<Plan[]> {
    const plans: Plan[] = [];
    for (const planPath of await planFilesForSource(filePath)) {
      const plan = await parsePlanArtifact(planPath);
      if (plan) plans.push(plan);
    }
    return plans;
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
