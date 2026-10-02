import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { getHomeDir } from '../home-dir.ts';
import {
  createStructuredSessionAdapter,
  type StructuredPlanCandidate,
} from './structured-session.ts';

/**
 * T3 Code (https://github.com/pingdotgg/t3code) keeps no plan files on disk.
 * Proposed plans are rows in the local SQLite projection database at
 * `<T3CODE_HOME|~/.t3>/{userdata,dev}/state.sqlite`
 * (`projection_thread_proposed_plans.plan_markdown`). This adapter reads that
 * database read-only and emits one plan per proposed-plan row, attributing the
 * project workspace, branch, and worktree from the thread/project projections.
 */

const DATABASE_FILE = 'state.sqlite';
/** T3 stores production state under `userdata` and dev-server state under `dev`. */
const STATE_DIR_NAMES = ['userdata', 'dev'] as const;

interface ProposedPlanRow {
  plan_id: string;
  thread_id: string;
  turn_id: string | null;
  plan_markdown: string;
  created_at: string | null;
  updated_at: string | null;
  implemented_at?: string | null;
  implementation_thread_id?: string | null;
}

interface ThreadRow {
  thread_id: string;
  project_id: string | null;
  title: string | null;
  branch?: string | null;
  worktree_path?: string | null;
  deleted_at: string | null;
  archived_at?: string | null;
}

interface ProjectRow {
  project_id: string;
  title: string | null;
  workspace_root: string | null;
  deleted_at: string | null;
}

interface SessionRow {
  thread_id: string;
  provider_name: string | null;
}

type Query = <Row>(sql: string) => Row[];

export function getT3CodeBaseDir(): string {
  const envHome = process.env.T3CODE_HOME?.trim();
  if (envHome) return resolve(envHome);
  return join(getHomeDir(), '.t3');
}

export function getT3CodeStateDirs(): string[] {
  const base = getT3CodeBaseDir();
  return STATE_DIR_NAMES.map((name) => join(base, name));
}

/**
 * Only directories that exist get watchers. Reporting the live set (rather than
 * the fixed candidate list) lets the daemon's watch-path refresh notice when T3
 * creates `userdata` or `dev` after Agendex started and attach a watcher then.
 */
export function getT3CodeWatchDirs(): string[] {
  return getT3CodeStateDirs().filter((dir) => existsSync(dir));
}

export function getT3CodeDatabasePaths(): string[] {
  return getT3CodeStateDirs().map((dir) => join(dir, DATABASE_FILE));
}

function isDatabaseFileName(name: string): boolean {
  return (
    name === DATABASE_FILE || name === `${DATABASE_FILE}-wal` || name === `${DATABASE_FILE}-shm`
  );
}

function matchesT3CodeDatabase(filePath: string): boolean {
  const resolved = resolve(filePath);
  if (!isDatabaseFileName(basename(resolved))) return false;
  const dir = dirname(resolved);
  return getT3CodeStateDirs().some((stateDir) => resolve(stateDir) === dir);
}

function resolveT3CodeSourcePath(filePath: string): string {
  const resolved = resolve(filePath);
  const name = basename(resolved);
  if (name.endsWith('-wal') || name.endsWith('-shm')) {
    return join(dirname(resolved), name.replace(/-(wal|shm)$/, ''));
  }
  return resolved;
}

/**
 * A usable worktree has a `.git` entry: a directory for the main checkout or a
 * gitdir pointer file for linked worktrees. A bare leftover directory is not.
 */
function isGitWorktree(path: string): boolean {
  return existsSync(join(path, '.git'));
}

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function extractMarkdownTitle(markdown: string): string | undefined {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return heading[1]?.trim() || undefined;
    // Title must be the first non-empty line; anything else means no heading.
    return undefined;
  }
  return undefined;
}

/**
 * Each projection table is read with its own statement so a renamed or dropped
 * optional column in one table cannot disable another table's checks. Every
 * statement has a required core shape (always attempted last) and an optional
 * richer shape that adds metadata columns T3 introduced later.
 */
const PLAN_QUERIES = [
  `SELECT plan_id, thread_id, turn_id, plan_markdown, created_at, updated_at,
          implemented_at, implementation_thread_id
     FROM projection_thread_proposed_plans
    ORDER BY created_at ASC, plan_id ASC`,
  `SELECT plan_id, thread_id, turn_id, plan_markdown, created_at, updated_at
     FROM projection_thread_proposed_plans
    ORDER BY created_at ASC, plan_id ASC`,
];

/**
 * Thread rows carry the soft-delete flag. The core shape keeps `deleted_at` so
 * deleted threads stay excluded even if T3 renames a metadata column.
 */
const THREAD_QUERIES = [
  `SELECT thread_id, project_id, title, branch, worktree_path, deleted_at, archived_at
     FROM projection_threads`,
  `SELECT thread_id, project_id, title, deleted_at FROM projection_threads`,
];

const PROJECT_QUERIES = [
  `SELECT project_id, title, workspace_root, deleted_at FROM projection_projects`,
  `SELECT project_id, title, NULL AS workspace_root, deleted_at FROM projection_projects`,
  `SELECT project_id, NULL AS title, NULL AS workspace_root, deleted_at
     FROM projection_projects`,
];

const SESSION_QUERIES = [`SELECT thread_id, provider_name FROM projection_thread_sessions`];

function firstSuccessful<Row>(query: Query, statements: readonly string[]): Row[] | undefined {
  for (const sql of statements) {
    try {
      return query<Row>(sql);
    } catch {
      // Try the next, more conservative shape.
    }
  }
  return undefined;
}

interface Snapshot {
  plans: ProposedPlanRow[];
  threads: Map<string, ThreadRow>;
  projects: Map<string, ProjectRow>;
  sessions: Map<string, SessionRow>;
}

function readSnapshot(query: Query): Snapshot | undefined {
  const plans = firstSuccessful<ProposedPlanRow>(query, PLAN_QUERIES);
  if (!plans) return undefined;
  // Deletion state is required: without it, plans from deleted threads or
  // projects would resurface. Refuse to index rather than leak them.
  const threads = firstSuccessful<ThreadRow>(query, THREAD_QUERIES);
  const projects = firstSuccessful<ProjectRow>(query, PROJECT_QUERIES);
  if (!threads || !projects) return undefined;
  const sessions = firstSuccessful<SessionRow>(query, SESSION_QUERIES) ?? [];
  return {
    plans,
    threads: new Map(threads.map((row) => [row.thread_id, row])),
    projects: new Map(projects.map((row) => [row.project_id, row])),
    sessions: new Map(sessions.map((row) => [row.thread_id, row])),
  };
}

async function openAndRead(filePath: string): Promise<Snapshot | undefined> {
  if (typeof Bun !== 'undefined') {
    const { Database } = await import('bun:sqlite');
    const database = new Database(filePath, { readonly: true, create: false });
    try {
      return readSnapshot(<Row>(sql: string) => database.query(sql).all() as Row[]);
    } finally {
      database.close();
    }
  }
  const { default: Database } = await import('better-sqlite3');
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return readSnapshot(<Row>(sql: string) => database.prepare(sql).all() as Row[]);
  } finally {
    database.close();
  }
}

async function decodeT3CodeDatabase(filePath: string): Promise<StructuredPlanCandidate[]> {
  const snapshot = await openAndRead(filePath);
  if (!snapshot) return [];
  const candidates: StructuredPlanCandidate[] = [];

  for (const row of snapshot.plans) {
    if (typeof row.plan_markdown !== 'string' || !row.plan_markdown.trim()) continue;

    const thread = snapshot.threads.get(row.thread_id);
    if (thread?.deleted_at) continue;
    const project = thread?.project_id ? snapshot.projects.get(thread.project_id) : undefined;
    if (project?.deleted_at) continue;
    const session = snapshot.sessions.get(row.thread_id);

    const threadTitle = nonEmpty(thread?.title);
    const title = extractMarkdownTitle(row.plan_markdown) ?? threadTitle ?? 'T3 Code Plan';
    // Prefer the thread's worktree while it is a real checkout so file receipts resolve
    // against the branch the plan was written for. T3 removes worktrees when a
    // thread is cleaned up, so fall back to the durable project root after that.
    const worktreePath = nonEmpty(thread?.worktree_path);
    const workspace =
      worktreePath && isGitWorktree(worktreePath)
        ? worktreePath
        : (nonEmpty(project?.workspace_root) ?? worktreePath);

    candidates.push({
      key: row.plan_id,
      title,
      content: row.plan_markdown,
      workspace,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at) ?? toDate(row.created_at),
      metadata: {
        planId: row.plan_id,
        threadId: row.thread_id,
        turnId: row.turn_id ?? undefined,
        threadTitle,
        branch: nonEmpty(thread?.branch),
        worktreePath: nonEmpty(thread?.worktree_path),
        projectId: nonEmpty(thread?.project_id),
        projectTitle: nonEmpty(project?.title),
        providerName: nonEmpty(session?.provider_name),
        implementedAt: nonEmpty(row.implemented_at),
        implementationThreadId: nonEmpty(row.implementation_thread_id),
        archived: Boolean(thread?.archived_at),
        planEvidence: 'proposed-plan-projection',
      },
    });
  }

  return candidates;
}

export const t3CodeAdapter = createStructuredSessionAdapter({
  agent: 't3-code',
  format: 'sqlite',
  getSearchPaths: getT3CodeStateDirs,
  getWatchPaths: getT3CodeWatchDirs,
  matches: matchesT3CodeDatabase,
  resolveSourcePath: resolveT3CodeSourcePath,
  decode: decodeT3CodeDatabase,
});
