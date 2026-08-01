import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { continueIdeAdapter } from './continue-ide.ts';
import { openCodeAdapter } from './opencode.ts';

const originalHome = process.env.HOME;
const originalXdgDataHome = process.env.XDG_DATA_HOME;
let tempRoot: string | undefined;

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdgDataHome;
  // Retries because recursive rm on Windows can transiently fail while the OS
  // finishes releasing handles. Anything holding a file open for longer is a
  // real leak and should still surface here rather than be retried away.
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  tempRoot = undefined;
});

test('Continue indexes only explicit Plan-mode assistant output', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-continue-session-'));
  process.env.HOME = tempRoot;
  const sessionsDir = join(tempRoot, '.continue', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify([
      {
        sessionId: 'session-1',
        title: 'OAuth rollout',
        workspaceDirectory: '/workspace/project',
      },
    ]),
  );
  const sessionPath = join(sessionsDir, 'session-1.json');
  await writeFile(
    sessionPath,
    JSON.stringify({
      history: [
        { role: 'user', content: 'secret prompt', mode: 'plan' },
        { role: 'assistant', content: 'Unrelated answer' },
        { role: 'assistant', content: '# Plan v1\n\n- [ ] Draft', mode: 'plan' },
        { message: { role: 'assistant', content: '# Plan v2\n\n- [ ] Ship' }, agent: 'plan' },
      ],
    }),
  );

  const plans = await continueIdeAdapter.parse(sessionPath);
  expect(plans).toHaveLength(1);
  expect(plans[0]?.title).toBe('OAuth rollout');
  expect(plans[0]?.content).toBe('# Plan v2\n\n- [ ] Ship');
  expect(plans[0]?.content).not.toContain('secret prompt');
  expect(plans[0]?.metadata.planRevisionCount).toBe(2);
});

test('Continue rejects ordinary transcripts without plan evidence', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-continue-non-plan-'));
  process.env.HOME = tempRoot;
  const sessionsDir = join(tempRoot, '.continue', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const sessionPath = join(sessionsDir, 'session-1.json');
  await writeFile(
    sessionPath,
    JSON.stringify({ history: [{ role: 'assistant', content: '# Looks plan-like' }] }),
  );

  expect(await continueIdeAdapter.parse(sessionPath)).toEqual([]);
});

test('OpenCode indexes the latest assistant text emitted by the Plan agent', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-opencode-session-'));
  process.env.HOME = tempRoot;
  delete process.env.XDG_DATA_HOME;
  const dataDir = join(tempRoot, '.local', 'share', 'opencode');
  const databasePath = join(dataDir, 'opencode.db');
  await mkdir(dataDir, { recursive: true });

  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      directory TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const insertSession = database.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)');
  insertSession.run('session-1', 'OAuth rollout', '/workspace/project', 1000, 5000);
  const insertMessage = database.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
  const insertPart = database.prepare('INSERT INTO part VALUES (?, ?, ?)');
  insertMessage.run('m1', 'session-1', 2000, JSON.stringify({ role: 'assistant', agent: 'plan' }));
  insertPart.run('p1', 'm1', JSON.stringify({ type: 'text', text: '# Plan v1\n\n- [ ] Draft' }));
  insertPart.run('p2', 'm1', JSON.stringify({ type: 'reasoning', text: 'private reasoning' }));
  insertMessage.run('m2', 'session-1', 3000, JSON.stringify({ role: 'user', agent: 'plan' }));
  insertPart.run('p3', 'm2', JSON.stringify({ type: 'text', text: 'secret prompt' }));
  insertMessage.run('m3', 'session-1', 4000, JSON.stringify({ role: 'assistant', agent: 'plan' }));
  insertPart.run('p4', 'm3', JSON.stringify({ type: 'text', text: '# Plan v2\n\n- [ ] Ship' }));
  insertMessage.run('m4', 'session-1', 4500, JSON.stringify({ role: 'assistant', agent: 'build' }));
  insertPart.run('p5', 'm4', JSON.stringify({ type: 'text', text: 'Implementation finished' }));
  // Finalize before closing: Bun's `close()` does not finalize outstanding
  // prepared statements, so the connection stays open and Windows keeps the
  // database file locked, breaking the temp-directory cleanup in afterEach.
  // (`close(true)` surfaces this as "database is locked" rather than hiding it.)
  insertSession.finalize();
  insertMessage.finalize();
  insertPart.finalize();
  database.close(true);

  expect(openCodeAdapter.matches(databasePath)).toBe(true);
  expect(openCodeAdapter.matches(`${databasePath}-wal`)).toBe(true);
  expect(openCodeAdapter.matches(`${databasePath}-shm`)).toBe(true);
  expect(openCodeAdapter.matches(`${databasePath}.backup`)).toBe(false);
  expect(openCodeAdapter.matches(`${databasePath}-old`)).toBe(false);
  expect(openCodeAdapter.getSourcePath?.(`${databasePath}-wal`)).toBe(databasePath);
  expect(openCodeAdapter.getSourcePath?.(`${databasePath}-shm`)).toBe(databasePath);
  const plans = await openCodeAdapter.parse(databasePath);
  expect(plans).toHaveLength(1);
  expect(plans[0]?.title).toBe('OAuth rollout');
  expect(plans[0]?.content).toBe('# Plan v2\n\n- [ ] Ship');
  expect(plans[0]?.content).not.toContain('secret prompt');
  expect(plans[0]?.content).not.toContain('private reasoning');
  expect(plans[0]?.metadata.planMessageCount).toBe(2);
  expect(plans[0]?.workspace).toBe('/workspace/project');
});
