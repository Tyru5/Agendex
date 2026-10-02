import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractMarkdownTitle,
  getT3CodeDatabasePaths,
  getT3CodeStateDirs,
  getT3CodeWatchDirs,
  t3CodeAdapter,
} from './t3-code.ts';

const originalHome = process.env.HOME;
const originalT3Home = process.env.T3CODE_HOME;
let tempRoot: string | undefined;

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalT3Home === undefined) delete process.env.T3CODE_HOME;
  else process.env.T3CODE_HOME = originalT3Home;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  tempRoot = undefined;
});

const SCHEMA = `
  CREATE TABLE projection_projects (
    project_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    scripts_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE projection_threads (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    branch TEXT,
    worktree_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    archived_at TEXT
  );
  CREATE TABLE projection_thread_sessions (
    thread_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    provider_name TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE projection_thread_proposed_plans (
    plan_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    turn_id TEXT,
    plan_markdown TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    implemented_at TEXT,
    implementation_thread_id TEXT
  );
`;

async function seedDatabase(stateDir: string): Promise<string> {
  await mkdir(stateDir, { recursive: true });
  const databasePath = join(stateDir, 'state.sqlite');
  const database = new Database(databasePath);
  database.exec(SCHEMA);

  const insertProject = database.prepare('INSERT INTO projection_projects VALUES (?,?,?,?,?,?,?)');
  insertProject.run(
    'proj-1',
    'Agendex',
    '/workspace/agendex',
    '[]',
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    null,
  );
  insertProject.run(
    'proj-deleted',
    'Old project',
    '/workspace/old',
    '[]',
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    '2026-01-05T00:00:00.000Z',
  );

  const insertThread = database.prepare(
    'INSERT INTO projection_threads VALUES (?,?,?,?,?,?,?,?,?)',
  );
  insertThread.run(
    'thread-1',
    'proj-1',
    'Add T3 adapter',
    't3code/abc',
    '/home/u/.t3/worktrees/agendex/abc',
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    null,
    null,
  );
  insertThread.run(
    'thread-deleted',
    'proj-1',
    'Deleted thread',
    null,
    null,
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    '2026-01-03T00:00:00.000Z',
    null,
  );
  insertThread.run(
    'thread-archived',
    'proj-1',
    'Archived thread',
    null,
    null,
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    null,
    '2026-01-03T00:00:00.000Z',
  );
  insertThread.run(
    'thread-in-deleted-project',
    'proj-deleted',
    'Live thread, dead project',
    null,
    null,
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    null,
    null,
  );

  const insertSession = database.prepare('INSERT INTO projection_thread_sessions VALUES (?,?,?,?)');
  insertSession.run('thread-1', 'ready', 'claude', '2026-01-02T00:00:00.000Z');

  const insertPlan = database.prepare(
    'INSERT INTO projection_thread_proposed_plans VALUES (?,?,?,?,?,?,?,?)',
  );
  insertPlan.run(
    'plan:thread-1:turn:a',
    'thread-1',
    'turn-a',
    '# Plan v1\n\n- [ ] Draft',
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T10:00:00.000Z',
    null,
    null,
  );
  insertPlan.run(
    'plan:thread-1:turn:b',
    'thread-1',
    'turn-b',
    '# Plan v2\n\n- [ ] Ship',
    '2026-01-01T11:00:00.000Z',
    '2026-01-01T11:30:00.000Z',
    '2026-01-01T12:00:00.000Z',
    'thread-impl',
  );
  insertPlan.run(
    'plan:thread-deleted:turn:c',
    'thread-deleted',
    'turn-c',
    '# Should be hidden',
    '2026-01-01T13:00:00.000Z',
    '2026-01-01T13:00:00.000Z',
    null,
    null,
  );
  insertPlan.run(
    'plan:thread-archived:turn:d',
    'thread-archived',
    'turn-d',
    'No heading here\n\nbody',
    '2026-01-01T14:00:00.000Z',
    '2026-01-01T14:00:00.000Z',
    null,
    null,
  );
  insertPlan.run(
    'plan:thread-1:turn:e',
    'thread-1',
    'turn-e',
    '   \n',
    '2026-01-01T15:00:00.000Z',
    '2026-01-01T15:00:00.000Z',
    null,
    null,
  );
  insertPlan.run(
    'plan:thread-in-deleted-project:turn:f',
    'thread-in-deleted-project',
    'turn-f',
    '# Should be hidden too',
    '2026-01-01T16:00:00.000Z',
    '2026-01-01T16:00:00.000Z',
    null,
    null,
  );

  insertProject.finalize();
  insertThread.finalize();
  insertSession.finalize();
  insertPlan.finalize();
  database.close(true);
  return databasePath;
}

test('T3 Code resolves state dirs under ~/.t3 and honors T3CODE_HOME', () => {
  process.env.HOME = '/home/example';
  delete process.env.T3CODE_HOME;
  expect(getT3CodeStateDirs()).toEqual([
    join('/home/example', '.t3', 'userdata'),
    join('/home/example', '.t3', 'dev'),
  ]);
  process.env.T3CODE_HOME = '/custom/t3';
  expect(getT3CodeWatchDirs()).toEqual([]);
  expect(getT3CodeDatabasePaths()).toEqual([
    join('/custom/t3', 'userdata', 'state.sqlite'),
    join('/custom/t3', 'dev', 'state.sqlite'),
  ]);
});

test('extractMarkdownTitle reads only a leading heading', () => {
  expect(extractMarkdownTitle('# Title\n\nbody')).toBe('Title');
  expect(extractMarkdownTitle('\n\n## Sub title ##\nbody')).toBe('Sub title');
  expect(extractMarkdownTitle('intro\n# Later heading')).toBeUndefined();
  expect(extractMarkdownTitle('')).toBeUndefined();
});

test('T3 Code indexes proposed plans from the projection database', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-t3-code-'));
  process.env.HOME = tempRoot;
  delete process.env.T3CODE_HOME;
  const stateDir = join(tempRoot, '.t3', 'userdata');
  const databasePath = await seedDatabase(stateDir);

  expect(t3CodeAdapter.matches(databasePath)).toBe(true);
  expect(t3CodeAdapter.matches(`${databasePath}-wal`)).toBe(true);
  expect(t3CodeAdapter.matches(`${databasePath}-shm`)).toBe(true);
  expect(t3CodeAdapter.matches(`${databasePath}.backup`)).toBe(false);
  expect(t3CodeAdapter.matches(join(tempRoot, '.t3', 'other', 'state.sqlite'))).toBe(false);
  expect(t3CodeAdapter.getSourcePath?.(`${databasePath}-wal`)).toBe(databasePath);
  expect(t3CodeAdapter.getSourcePath?.(`${databasePath}-shm`)).toBe(databasePath);

  const plans = await t3CodeAdapter.parse(databasePath);
  expect(plans.map((plan) => plan.title)).toEqual(['Plan v1', 'Plan v2', 'Archived thread']);
  expect(new Set(plans.map((plan) => plan.id)).size).toBe(3);
  expect(plans.map((plan) => plan.content).join('\n')).not.toContain('Should be hidden');
  expect(getT3CodeWatchDirs()).toEqual([stateDir]);

  const v2 = plans[1]!;
  expect(v2.agent).toBe('t3-code');
  expect(v2.format).toBe('sqlite');
  expect(v2.filePath).toBe(databasePath);
  expect(v2.content).toBe('# Plan v2\n\n- [ ] Ship');
  // Worktree path does not exist on disk, so the durable project root wins.
  expect(v2.workspace).toBe('/workspace/agendex');
  expect(v2.createdAt.toISOString()).toBe('2026-01-01T11:00:00.000Z');
  expect(v2.updatedAt.toISOString()).toBe('2026-01-01T11:30:00.000Z');
  expect(v2.metadata).toMatchObject({
    source: 'structured-session',
    planId: 'plan:thread-1:turn:b',
    threadId: 'thread-1',
    turnId: 'turn-b',
    threadTitle: 'Add T3 adapter',
    branch: 't3code/abc',
    worktreePath: '/home/u/.t3/worktrees/agendex/abc',
    projectTitle: 'Agendex',
    providerName: 'claude',
    implementedAt: '2026-01-01T12:00:00.000Z',
    implementationThreadId: 'thread-impl',
    archived: false,
    planEvidence: 'proposed-plan-projection',
  });

  const archived = plans[2]!;
  expect(archived.metadata.archived).toBe(true);
  expect(archived.metadata.branch).toBeUndefined();
});

test('T3 Code falls back to core columns when optional metadata columns are missing', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-t3-code-minimal-'));
  process.env.T3CODE_HOME = join(tempRoot, 't3home');
  const stateDir = join(tempRoot, 't3home', 'dev');
  await mkdir(stateDir, { recursive: true });
  const databasePath = join(stateDir, 'state.sqlite');
  const database = new Database(databasePath);
  // Older/renamed schema: no implemented_at, branch, worktree_path, archived_at,
  // workspace_root, and no sessions table. Deletion flags must still apply.
  database.exec(`
    CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, title TEXT, deleted_at TEXT);
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projection_projects VALUES
      ('p-live', 'Live', NULL),
      ('p-dead', 'Dead', '2026-02-02T00:00:00.000Z');
    INSERT INTO projection_threads VALUES
      ('t-live', 'p-live', 'Live thread', NULL),
      ('t-deleted', 'p-live', 'Deleted thread', '2026-02-03T00:00:00.000Z'),
      ('t-dead-project', 'p-dead', 'Thread in dead project', NULL);
    INSERT INTO projection_thread_proposed_plans VALUES
      ('plan:x', 't-live', 'turn-x', 'Untitled body', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('plan:y', 't-deleted', 'turn-y', '# Hidden deleted thread', '2026-02-01T01:00:00.000Z', '2026-02-01T01:00:00.000Z'),
      ('plan:z', 't-dead-project', 'turn-z', '# Hidden deleted project', '2026-02-01T02:00:00.000Z', '2026-02-01T02:00:00.000Z');
  `);
  database.close(true);

  expect(t3CodeAdapter.matches(databasePath)).toBe(true);
  expect(getT3CodeWatchDirs()).toEqual([stateDir]);
  const plans = await t3CodeAdapter.parse(databasePath);
  expect(plans).toHaveLength(1);
  expect(plans[0]?.title).toBe('Live thread');
  expect(plans[0]?.content).toBe('Untitled body');
  expect(plans[0]?.workspace).toBeUndefined();
  expect(plans[0]?.metadata).toMatchObject({
    threadId: 't-live',
    projectId: 'p-live',
    projectTitle: 'Live',
    archived: false,
  });
  expect(plans[0]?.metadata.providerName).toBeUndefined();
  expect(plans[0]?.metadata.implementedAt).toBeUndefined();
});

test('T3 Code prefers an existing thread worktree over the project root', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-t3-code-worktree-'));
  process.env.HOME = tempRoot;
  delete process.env.T3CODE_HOME;
  const stateDir = join(tempRoot, '.t3', 'userdata');
  const worktreeDir = join(tempRoot, '.t3', 'worktrees', 'agendex', 'abc');
  await mkdir(stateDir, { recursive: true });
  await mkdir(worktreeDir, { recursive: true });
  const databasePath = join(stateDir, 'state.sqlite');
  const database = new Database(databasePath);
  database.exec(SCHEMA);
  database.exec(`
    INSERT INTO projection_projects VALUES
      ('proj-1', 'Agendex', '/workspace/agendex', '[]', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL);
    INSERT INTO projection_threads VALUES
      ('thread-live-wt', 'proj-1', 'Live worktree', 't3code/abc', '${worktreeDir}', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL, NULL),
      ('thread-gone-wt', 'proj-1', 'Removed worktree', 't3code/xyz', '${join(tempRoot, 'missing')}', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL, NULL);
    INSERT INTO projection_thread_proposed_plans VALUES
      ('plan:live', 'thread-live-wt', 'turn-1', '# Live', '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z', NULL, NULL),
      ('plan:gone', 'thread-gone-wt', 'turn-2', '# Gone', '2026-01-01T11:00:00.000Z', '2026-01-01T11:00:00.000Z', NULL, NULL);
  `);
  database.close(true);

  const plans = await t3CodeAdapter.parse(databasePath);
  expect(plans.map((plan) => [plan.title, plan.workspace])).toEqual([
    ['Live', worktreeDir],
    ['Gone', '/workspace/agendex'],
  ]);
  expect(plans[1]?.metadata.worktreePath).toBe(join(tempRoot, 'missing'));
});

test('T3 Code refuses to index when deletion state cannot be read', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-t3-code-no-threads-'));
  process.env.HOME = tempRoot;
  delete process.env.T3CODE_HOME;
  const stateDir = join(tempRoot, '.t3', 'userdata');
  await mkdir(stateDir, { recursive: true });
  const databasePath = join(stateDir, 'state.sqlite');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projection_thread_proposed_plans VALUES
      ('plan:x', 't-1', 'turn-x', '# Unknown deletion state', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
  `);
  database.close(true);

  expect(await t3CodeAdapter.parse(databasePath)).toEqual([]);
});

test('T3 Code returns no plans for a database without the plan table', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-t3-code-empty-'));
  process.env.HOME = tempRoot;
  delete process.env.T3CODE_HOME;
  const stateDir = join(tempRoot, '.t3', 'userdata');
  await mkdir(stateDir, { recursive: true });
  const databasePath = join(stateDir, 'state.sqlite');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY);');
  database.close(true);

  expect(await t3CodeAdapter.parse(databasePath)).toEqual([]);
});
