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
  thread_title?: string | null;
  thread_branch?: string | null;
  thread_worktree_path?: string | null;
  thread_deleted_at?: string | null;
  thread_archived_at?: string | null;
  project_id?: string | null;
  project_title?: string | null;
  project_workspace_root?: string | null;
  provider_name?: string | null;
}

export function getT3CodeBaseDir(): string {
  const envHome = process.env.T3CODE_HOME?.trim();
  if (envHome) return resolve(envHome);
  return join(getHomeDir(), '.t3');
}

export function getT3CodeStateDirs(): string[] {
  const base = getT3CodeBaseDir();
  return STATE_DIR_NAMES.map((name) => join(base, name));
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

const FULL_QUERY = `SELECT
    pp.plan_id,
    pp.thread_id,
    pp.turn_id,
    pp.plan_markdown,
    pp.created_at,
    pp.updated_at,
    pp.implemented_at,
    pp.implementation_thread_id,
    t.title AS thread_title,
    t.branch AS thread_branch,
    t.worktree_path AS thread_worktree_path,
    t.deleted_at AS thread_deleted_at,
    t.archived_at AS thread_archived_at,
    t.project_id AS project_id,
    p.title AS project_title,
    p.workspace_root AS project_workspace_root,
    s.provider_name AS provider_name
  FROM projection_thread_proposed_plans pp
  LEFT JOIN projection_threads t ON t.thread_id = pp.thread_id
  LEFT JOIN projection_projects p ON p.project_id = t.project_id
  LEFT JOIN projection_thread_sessions s ON s.thread_id = pp.thread_id
  ORDER BY pp.created_at ASC, pp.plan_id ASC`;

/** Fallback when T3 renames or drops a joined projection column. */
const MINIMAL_QUERY = `SELECT
    plan_id,
    thread_id,
    turn_id,
    plan_markdown,
    created_at,
    updated_at
  FROM projection_thread_proposed_plans
  ORDER BY created_at ASC, plan_id ASC`;

async function readRows(filePath: string): Promise<ProposedPlanRow[]> {
  const run = async (query: (sql: string) => ProposedPlanRow[]): Promise<ProposedPlanRow[]> => {
    try {
      return query(FULL_QUERY);
    } catch {
      return query(MINIMAL_QUERY);
    }
  };

  if (typeof Bun !== 'undefined') {
    const { Database } = await import('bun:sqlite');
    const database = new Database(filePath, { readonly: true, create: false });
    try {
      return await run((sql) => database.query(sql).all() as ProposedPlanRow[]);
    } finally {
      database.close();
    }
  }
  const { default: Database } = await import('better-sqlite3');
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return await run((sql) => database.prepare(sql).all() as ProposedPlanRow[]);
  } finally {
    database.close();
  }
}

async function decodeT3CodeDatabase(filePath: string): Promise<StructuredPlanCandidate[]> {
  const rows = await readRows(filePath);
  const candidates: StructuredPlanCandidate[] = [];

  for (const row of rows) {
    if (row.thread_deleted_at) continue;
    if (typeof row.plan_markdown !== 'string' || !row.plan_markdown.trim()) continue;

    const threadTitle = nonEmpty(row.thread_title);
    const title = extractMarkdownTitle(row.plan_markdown) ?? threadTitle ?? 'T3 Code Plan';
    const workspace = nonEmpty(row.project_workspace_root) ?? nonEmpty(row.thread_worktree_path);

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
        branch: nonEmpty(row.thread_branch),
        worktreePath: nonEmpty(row.thread_worktree_path),
        projectId: nonEmpty(row.project_id),
        projectTitle: nonEmpty(row.project_title),
        providerName: nonEmpty(row.provider_name),
        implementedAt: nonEmpty(row.implemented_at),
        implementationThreadId: nonEmpty(row.implementation_thread_id),
        archived: Boolean(row.thread_archived_at),
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
  matches: matchesT3CodeDatabase,
  resolveSourcePath: resolveT3CodeSourcePath,
  decode: decodeT3CodeDatabase,
});
