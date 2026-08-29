import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { getActiveAdapters, setActiveAdapters } from './registry.ts';

const originalAdapters = getActiveAdapters();
const originalEnv: Record<string, string | undefined> = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PI_CODING_AGENT_SESSION_DIR: process.env.PI_CODING_AGENT_SESSION_DIR,
};

let tempHome: string | undefined;

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function useTempHome() {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-omp-'));
  const parsedHome = parse(tempHome);
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);
  delete process.env.XDG_DATA_HOME;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  return tempHome;
}

/** Creates `<home>/.omp/agent/sessions/<encodedCwd>/<stem>/local` and returns its path. */
async function makeSessionArtifactDir(
  home: string,
  encodedCwd: string,
  stem: string,
): Promise<string> {
  const dir = join(home, '.omp', 'agent', 'sessions', encodedCwd, stem, 'local');
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeSessionFile(
  home: string,
  encodedCwd: string,
  stem: string,
  lines: string[],
): Promise<string> {
  const path = join(home, '.omp', 'agent', 'sessions', encodedCwd, `${stem}.jsonl`);
  await writeFile(path, `${lines.join('\n')}\n`, 'utf-8');
  return path;
}

afterEach(async () => {
  setActiveAdapters(originalAdapters);
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    restoreEnv(key);
  }
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

test('discovers the ~/.omp/agent/sessions directory', async () => {
  const home = await useTempHome();
  const sessionsDir = join(home, '.omp', 'agent', 'sessions');
  await mkdir(sessionsDir, { recursive: true });

  const { ompAdapter } = await import('./omp.ts');
  expect(ompAdapter.getSearchPaths()).toContain(sessionsDir);
});

test('honors PI_CODING_AGENT_DIR and XDG_DATA_HOME session locations', async () => {
  const home = await useTempHome();
  process.env.PI_CODING_AGENT_DIR = join(home, 'custom-agent');
  process.env.XDG_DATA_HOME = join(home, 'xdg-data');

  const { ompAdapter } = await import('./omp.ts');
  const paths = ompAdapter.getSearchPaths();
  expect(paths).toContain(join(home, 'custom-agent', 'sessions'));
  expect(paths).toContain(join(home, 'xdg-data', 'omp', 'sessions'));
  expect(paths).toContain(join(home, '.omp', 'agent', 'sessions'));
});

test('matches plan artifacts and their companion session files', async () => {
  const home = await useTempHome();
  const localDir = await makeSessionArtifactDir(home, '-work-foo', '2026-05-14_abc123');

  const { ompAdapter } = await import('./omp.ts');
  expect(ompAdapter.matches(join(localDir, 'auth-storage-plan.md'))).toBe(true);
  expect(ompAdapter.matches(join(localDir, 'PLAN.md'))).toBe(true);
  expect(ompAdapter.matches(join(localDir, 'notes.md'))).toBe(false);
  const sessionPath = join(
    home,
    '.omp',
    'agent',
    'sessions',
    '-work-foo',
    '2026-05-14_abc123.jsonl',
  );
  expect(ompAdapter.matches(sessionPath)).toBe(true);
  expect(ompAdapter.getSourcePath?.(join(localDir, 'auth-storage-plan.md'))).toBe(sessionPath);
  expect(ompAdapter.getSourcePath?.(sessionPath)).toBe(sessionPath);
  // Plan-named files outside the sessions tree are not omp artifacts.
  expect(ompAdapter.matches(join(home, 'local', 'auth-storage-plan.md'))).toBe(false);
});

test('creates omp plans at a path that remains discoverable after a full scan', async () => {
  await useTempHome();

  const { ompAdapter } = await import('./omp.ts');
  const { create, getById, scan } = await import('../services/plan-service.ts');
  setActiveAdapters([ompAdapter]);

  const created = await create('omp', 'Persist this plan', '- [ ] Keep it indexed');
  expect(ompAdapter.matches(created.filePath)).toBe(true);
  expect(created.filePath).toEndWith('local/persist-this-plan.md');

  await scan();
  expect(getById(created.id)?.title).toBe('Persist this plan');
  expect(getById(created.id)?.content).toContain('Keep it indexed');
});

test('parses a plan draft with session metadata', async () => {
  const home = await useTempHome();
  const stem = '2026-05-14T10-12-03_0196f000-1a2b-7c3d-8e4f-aabbccddeeff';
  const localDir = await makeSessionArtifactDir(home, '-work-api', stem);
  await writeSessionFile(home, '-work-api', stem, [
    JSON.stringify({ type: 'title', v: 1, title: 'refactor importer', source: 'auto' }),
    JSON.stringify({
      type: 'session',
      version: 3,
      id: '0196f000-1a2b-7c3d-8e4f-aabbccddeeff',
      timestamp: '2026-05-14T10:12:03Z',
      cwd: '/work/api',
    }),
    JSON.stringify({ type: 'message', id: '1f9d2a0b', parentId: null }),
  ]);
  const planPath = join(localDir, 'streaming-importer-plan.md');
  await writeFile(planPath, '# Plan: Stream the importer\n\n1. Do the thing.\n', 'utf-8');

  const { ompAdapter } = await import('./omp.ts');
  const [plan] = await ompAdapter.parse(planPath);

  expect(plan?.agent).toBe('omp');
  expect(plan?.title).toBe('Stream the importer');
  expect(plan?.workspace).toBe('/work/api');
  expect(plan?.metadata.sessionId).toBe('0196f000-1a2b-7c3d-8e4f-aabbccddeeff');
  expect(plan?.metadata.sessionIdSource).toBe('omp');
  expect(plan?.createdAt.toISOString()).toBe('2026-05-14T10:12:03.000Z');
  expect(plan?.format).toBe('md');
});

test('falls back to session title, slug, and path-derived session id', async () => {
  const home = await useTempHome();
  const stem = '2026-05-14T10-12-03_deadbeef';
  const localDir = await makeSessionArtifactDir(home, '-work-api', stem);
  const planPath = join(localDir, 'auth-storage-plan.md');
  await writeFile(planPath, 'No heading in this draft.\n', 'utf-8');

  const { ompAdapter } = await import('./omp.ts');

  // No session file at all: slug title + session id from the directory name.
  const [fromSlug] = await ompAdapter.parse(planPath);
  expect(fromSlug?.title).toBe('Auth Storage');
  expect(fromSlug?.metadata.sessionId).toBe('deadbeef');
  expect(fromSlug?.workspace).toBeUndefined();

  // Title-slot line wins over the slug when the session file exists.
  await writeSessionFile(home, '-work-api', stem, [
    JSON.stringify({ type: 'title', v: 1, title: 'auth storage session' }),
    JSON.stringify({ type: 'session', version: 3, id: 'deadbeef', cwd: '/work/api' }),
  ]);
  const [fromSession] = await ompAdapter.parse(planPath);
  expect(fromSession?.title).toBe('auth storage session');
  expect(fromSession?.workspace).toBe('/work/api');
});

test('refreshes indexed metadata when the companion session file changes', async () => {
  const home = await useTempHome();
  const stem = '2026-05-14T10-12-03_deadbeef';
  const localDir = await makeSessionArtifactDir(home, '-work-api', stem);
  const planPath = join(localDir, 'auth-storage-plan.md');
  await writeFile(planPath, 'No heading in this draft.\n', 'utf-8');
  const sessionPath = await writeSessionFile(home, '-work-api', stem, [
    JSON.stringify({ type: 'title', v: 1, title: 'Old title' }),
    JSON.stringify({ type: 'session', version: 3, id: 'deadbeef', cwd: '/work/old' }),
  ]);

  const { ompAdapter } = await import('./omp.ts');
  const { getById, rescanFile } = await import('../services/plan-service.ts');
  setActiveAdapters([ompAdapter]);

  const [initial] = await rescanFile(planPath);
  expect(initial?.title).toBe('Old title');
  expect(initial?.workspace).toBe('/work/old');

  await writeFile(
    sessionPath,
    `${JSON.stringify({ type: 'title', v: 1, title: 'New title' })}\n${JSON.stringify({ type: 'session', version: 3, id: 'deadbeef', cwd: '/work/new' })}\n`,
    'utf-8',
  );
  await rescanFile(sessionPath);

  expect(getById(initial?.id ?? '')?.title).toBe('New title');
  expect(getById(initial?.id ?? '')?.workspace).toBe('/work/new');
});

test('skips empty plan drafts and writes edits back to the artifact', async () => {
  const home = await useTempHome();
  const localDir = await makeSessionArtifactDir(home, '-work-api', '2026-05-14_feed1234');
  const planPath = join(localDir, 'PLAN.md');
  await writeFile(planPath, '   \n', 'utf-8');

  const { ompAdapter } = await import('./omp.ts');
  expect(await ompAdapter.parse(planPath)).toEqual([]);

  await writeFile(planPath, '# A plan\n\n- step\n', 'utf-8');
  const [plan] = await ompAdapter.parse(planPath);
  expect(plan).toBeDefined();
  if (!plan) throw new Error('expected plan');

  expect(await ompAdapter.write(plan, '# A plan\n\n- revised step\n')).toBe(true);
  const [rewritten] = await ompAdapter.parse(planPath);
  expect(rewritten?.content).toContain('revised step');
});
