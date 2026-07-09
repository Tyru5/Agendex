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
};

let tempHome: string | undefined;

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function useTempHome() {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-grok-'));
  const parsedHome = parse(tempHome);
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);
  return tempHome;
}

async function makeSession(home: string, encodedCwd: string, sessionId: string): Promise<string> {
  const dir = join(home, '.grok', 'sessions', encodedCwd, sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
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

test('discovers the ~/.grok/sessions directory', async () => {
  const home = await useTempHome();
  const sessionsDir = join(home, '.grok', 'sessions');
  await mkdir(sessionsDir, { recursive: true });

  const { grokAdapter } = await import('./grok.ts');
  expect(grokAdapter.getSearchPaths()).toContain(sessionsDir);
});

test('matches plan.md under the sessions dir only', async () => {
  const home = await useTempHome();
  const dir = await makeSession(home, '%2Frepo', 'sess-1');

  const { grokAdapter } = await import('./grok.ts');
  expect(grokAdapter.matches(join(dir, 'plan.md'))).toBe(true);
  expect(grokAdapter.matches(join(dir, 'chat_history.jsonl'))).toBe(false);
  expect(grokAdapter.matches(join(home, 'plan.md'))).toBe(false);
});

test('parses a plan with summary.json metadata', async () => {
  const home = await useTempHome();
  const dir = await makeSession(home, '%2Fworkspace%2Frepo', 'abc-123');
  const planPath = join(dir, 'plan.md');
  await writeFile(planPath, '# Fix the widget\n\nSteps here.\n', 'utf-8');
  await writeFile(
    join(dir, 'summary.json'),
    JSON.stringify({
      info: { id: 'abc-123', cwd: '/workspace/repo' },
      session_summary: 'Summary title',
      generated_title: 'Generated title',
      created_at: '2026-01-02T03:04:05.000Z',
      updated_at: '2026-01-02T04:05:06.000Z',
      head_branch: 'main',
      head_commit: 'deadbeef',
      current_model_id: 'grok-4.5',
    }),
    'utf-8',
  );

  const { grokAdapter } = await import('./grok.ts');
  const [plan] = await grokAdapter.parse(planPath);

  expect(plan?.agent).toBe('grok');
  expect(plan?.title).toBe('Fix the widget');
  expect(plan?.workspace).toBe('/workspace/repo');
  expect(plan?.metadata.sessionId).toBe('abc-123');
  expect(plan?.metadata.sessionIdSource).toBe('grok');
  expect(plan?.metadata.branch).toBe('main');
  expect(plan?.metadata.commit).toBe('deadbeef');
  expect(plan?.metadata.model).toBe('grok-4.5');
  expect(plan?.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  expect(plan?.updatedAt.toISOString()).toBe('2026-01-02T04:05:06.000Z');
});

test('falls back to session_summary then generated_title when no heading', async () => {
  const home = await useTempHome();
  const dir = await makeSession(home, '%2Frepo', 'sess-2');
  const planPath = join(dir, 'plan.md');
  await writeFile(planPath, 'Just a body with no heading.\n', 'utf-8');

  await writeFile(
    join(dir, 'summary.json'),
    JSON.stringify({ info: { id: 'sess-2' }, session_summary: 'From summary' }),
    'utf-8',
  );
  const { grokAdapter } = await import('./grok.ts');
  const [fromSummary] = await grokAdapter.parse(planPath);
  expect(fromSummary?.title).toBe('From summary');

  await writeFile(
    join(dir, 'summary.json'),
    JSON.stringify({ info: { id: 'sess-2' }, generated_title: 'From generated' }),
    'utf-8',
  );
  const { grokAdapter: adapter2 } = await import('./grok.ts');
  const [fromGenerated] = await adapter2.parse(planPath);
  expect(fromGenerated?.title).toBe('From generated');
});

test('skips empty plan.md', async () => {
  const home = await useTempHome();
  const dir = await makeSession(home, '%2Frepo', 'sess-3');
  const planPath = join(dir, 'plan.md');
  await writeFile(planPath, '   \n\t\n', 'utf-8');

  const { grokAdapter } = await import('./grok.ts');
  expect(await grokAdapter.parse(planPath)).toEqual([]);
});

test('parses without summary.json using stats and heading', async () => {
  const home = await useTempHome();
  const dir = await makeSession(home, '%2Frepo', 'sess-4');
  const planPath = join(dir, 'plan.md');
  await writeFile(planPath, '# Plan: Build it\n\nBody.\n', 'utf-8');

  const { grokAdapter } = await import('./grok.ts');
  const [plan] = await grokAdapter.parse(planPath);

  expect(plan?.title).toBe('Build it');
  expect(plan?.workspace).toBeUndefined();
  expect(plan?.metadata.sessionId).toBe('sess-4');
  expect(plan?.createdAt).toBeInstanceOf(Date);
  expect(plan?.updatedAt).toBeInstanceOf(Date);
});
