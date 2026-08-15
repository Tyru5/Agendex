import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig } from '@agendex/shared';
import type { CloudPlanDownload, FetchCloudPlanResult } from './api.ts';
import { isUsableLaunchPath, runDownload } from './download.ts';

let dir: string;
let prevConfigDir: string | undefined;
let prevPwd: string | undefined;
let prevInitCwd: string | undefined;

interface Capture {
  logs: string[];
  errors: string[];
  stdout: string[];
  written: { path: string; content: string }[];
  mkdir: string[];
  queries: { query: string; agent?: string }[];
  lastQuery?: { query: string; agent?: string };
  prompted?: { message: string; ids: string[] };
}

function samplePlan(overrides: Partial<CloudPlanDownload> = {}): CloudPlanDownload {
  return {
    id: 'plan-1',
    localPlanId: 'local-1',
    agent: 'claude-code',
    title: 'Add auth',
    content: '# Add auth\n\nUse existing session tokens.\n',
    format: 'markdown',
    filePath: '/tmp/add-auth.md',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(
  result:
    | FetchCloudPlanResult
    | ((query: string, agent?: string) => FetchCloudPlanResult | Promise<FetchCloudPlanResult>),
  cap: Capture,
  existingDirs: string[] = [],
  extras: Partial<Pick<Parameters<typeof runDownload>[1], 'canPrompt' | 'promptSelect'>> = {},
  existingFiles: string[] = [],
) {
  return {
    fetchCloudPlan: async (query: string, agent?: string) => {
      cap.lastQuery = { query, agent };
      cap.queries.push({ query, agent });
      return typeof result === 'function' ? await result(query, agent) : result;
    },
    log: (message: string) => cap.logs.push(message),
    error: (message: string) => cap.errors.push(message),
    writeStdout: (content: string) => cap.stdout.push(content),
    writeFile: async (path: string, content: string) => {
      cap.written.push({ path, content });
    },
    mkdir: async (path: string) => {
      cap.mkdir.push(path);
    },
    stat: async (path: string) => {
      if (existingDirs.includes(path)) {
        return { isDirectory: () => true } as Awaited<
          ReturnType<typeof import('node:fs/promises').stat>
        >;
      }
      if (existingFiles.includes(path)) {
        return { isDirectory: () => false } as Awaited<
          ReturnType<typeof import('node:fs/promises').stat>
        >;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    canPrompt: extras.canPrompt ?? (() => false),
    promptSelect: extras.promptSelect,
  };
}

function newCapture(): Capture {
  return { logs: [], errors: [], stdout: [], written: [], mkdir: [], queries: [] };
}

function writeLoggedInConfig(): void {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    convexUrl: 'https://example.convex.cloud',
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agendex-download-'));
  prevConfigDir = process.env.AGENDEX_CONFIG_DIR;
  prevPwd = process.env.PWD;
  prevInitCwd = process.env.INIT_CWD;
  process.env.AGENDEX_CONFIG_DIR = join(dir, 'config');
  process.env.PWD = dir;
  delete process.env.INIT_CWD;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = prevConfigDir;
  if (prevPwd === undefined) delete process.env.PWD;
  else process.env.PWD = prevPwd;
  if (prevInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = prevInitCwd;
  rmSync(dir, { recursive: true, force: true });
});

test('isUsableLaunchPath rejects POSIX PWD values on native Windows', () => {
  expect(isUsableLaunchPath('/c/Users/me', 'win32')).toBe(false);
  expect(isUsableLaunchPath('/cygdrive/c/Users/me', 'win32')).toBe(false);
  expect(isUsableLaunchPath('C:\\Users\\me', 'win32')).toBe(true);
  expect(isUsableLaunchPath('\\\\server\\share', 'win32')).toBe(true);
  expect(isUsableLaunchPath('/tmp/plans', 'darwin')).toBe(true);
});

test('errors when no query is provided', async () => {
  const cap = newCapture();
  const code = await runDownload(
    ['download'],
    makeDeps({ kind: 'not_found', suggestions: [] }, cap),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('usage: agendex download');
  expect(cap.errors.join('\n')).toContain('--force');
});

test('errors when --agent is missing its value', async () => {
  const cap = newCapture();
  const code = await runDownload(
    ['download', 'Add auth', '--agent'],
    makeDeps({ kind: 'not_found', suggestions: [] }, cap),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('--agent requires a name');
});

test('keeps download as the query after the command name', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan({ title: 'download' });
  const code = await runDownload(['download', 'download'], makeDeps({ kind: 'found', plan }, cap));
  expect(code).toBe(0);
  expect(cap.lastQuery).toEqual({ query: 'download', agent: undefined });
  expect(cap.errors.join('\n')).not.toContain('usage: agendex download');
});

test('fails fast when not logged in', async () => {
  const cap = newCapture();
  const code = await runDownload(
    ['download', 'Add auth'],
    makeDeps({ kind: 'not_found', suggestions: [] }, cap),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('agendex login');
  expect(cap.lastQuery).toBeUndefined();
});

test('rejects pdf format and invalid formats', async () => {
  writeLoggedInConfig();
  const pdf = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth', '--format', 'pdf'],
      makeDeps({ kind: 'not_found', suggestions: [] }, pdf),
    ),
  ).toBe(1);
  expect(pdf.errors.join('\n')).toContain('PDF download is available in the web app');

  const invalid = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth', '--format', 'docx'],
      makeDeps({ kind: 'not_found', suggestions: [] }, invalid),
    ),
  ).toBe(1);
  expect(invalid.errors.join('\n')).toContain('--format must be md or html');
});

test('downloads markdown by id and writes a sanitized filename', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan();
  const code = await runDownload(['download', plan.id], makeDeps({ kind: 'found', plan }, cap));
  expect(code).toBe(0);
  expect(cap.lastQuery).toEqual({ query: plan.id, agent: undefined });
  expect(cap.written).toHaveLength(1);
  expect(cap.written[0]?.path).toBe(join(dir, 'Add auth.md'));
  expect(cap.written[0]?.content).toBe(plan.content);
  expect(cap.logs.join('\n')).toContain('downloaded "Add auth"');
});

test('keeps the full title when --agent is already set', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan({ title: 'codex: Migration notes' });
  expect(
    await runDownload(
      ['download', 'codex: Migration notes', '--agent', 'claude-code'],
      makeDeps({ kind: 'found', plan }, cap),
    ),
  ).toBe(0);
  expect(cap.lastQuery).toEqual({ query: 'codex: Migration notes', agent: 'claude-code' });
});

test('parses agent/title queries and --agent, and writes html', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan({ title: 'Ship download' });
  const code = await runDownload(
    ['download', 'codex/Ship download', '--format', 'html'],
    makeDeps({ kind: 'found', plan }, cap),
  );
  expect(code).toBe(0);
  expect(cap.lastQuery).toEqual({ query: 'Ship download', agent: 'codex-cli' });
  expect(cap.written[0]?.path).toBe(join(dir, 'Ship download.html'));
  expect(cap.written[0]?.content).toContain('<!doctype html>');
  expect(cap.written[0]?.content).toContain('Ship download');
});

test('two positionals treat a known agent as the agent filter', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan();
  const code = await runDownload(
    ['download', 'Add auth', 'cursor'],
    makeDeps({ kind: 'found', plan }, cap),
  );
  expect(code).toBe(0);
  expect(cap.lastQuery).toEqual({ query: 'Add auth', agent: 'cursor' });
});

test('three or more positionals keep every word even if one is an agent name', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan({ title: 'Add codex support' });
  const code = await runDownload(
    ['download', 'Add', 'codex', 'support'],
    makeDeps({ kind: 'found', plan }, cap),
  );
  expect(code).toBe(0);
  expect(cap.lastQuery).toEqual({ query: 'Add codex support', agent: undefined });
});

test('infers html from --out extension and writes into a directory', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const outDir = join(dir, 'exports');
  const plan = samplePlan();
  const code = await runDownload(
    ['download', 'Add auth', '--out', outDir],
    makeDeps({ kind: 'found', plan }, cap, [outDir]),
  );
  expect(code).toBe(0);
  expect(cap.written[0]?.path).toBe(join(outDir, 'Add auth.md'));
});

test('infers html from a file --out path that does not exist yet', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const dest = join(dir, 'plan.html');
  const plan = samplePlan();
  expect(
    await runDownload(
      ['download', 'Add auth', '--out', dest],
      makeDeps({ kind: 'found', plan }, cap),
    ),
  ).toBe(0);
  expect(cap.written[0]?.path).toBe(dest);
  expect(cap.written[0]?.content).toContain('<!doctype html>');
});

test('treats a trailing-slash --out path as a directory even if it does not exist', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const outDir = join(dir, 'exports') + '/';
  const plan = samplePlan();
  expect(
    await runDownload(
      ['download', 'Add auth', '--out', outDir],
      makeDeps({ kind: 'found', plan }, cap),
    ),
  ).toBe(0);
  expect(cap.written[0]?.path).toBe(join(dir, 'exports', 'Add auth.md'));
});

test('does not infer format from an existing directory named like a file', async () => {
  writeLoggedInConfig();
  const plan = samplePlan();

  const htmlDir = join(dir, 'exports.html');
  const htmlCap = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth', '--out', htmlDir],
      makeDeps({ kind: 'found', plan }, htmlCap, [htmlDir]),
    ),
  ).toBe(0);
  expect(htmlCap.written[0]?.path).toBe(join(htmlDir, 'Add auth.md'));
  expect(htmlCap.written[0]?.content).toBe(plan.content);

  const pdfDir = join(dir, 'reports.pdf');
  const pdfCap = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth', '--out', pdfDir],
      makeDeps({ kind: 'found', plan }, pdfCap, [pdfDir]),
    ),
  ).toBe(0);
  expect(pdfCap.errors.join('\n')).not.toContain('PDF download');
  expect(pdfCap.written[0]?.path).toBe(join(pdfDir, 'Add auth.md'));
});

test('writes raw contents to stdout when --out is -', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan();
  const code = await runDownload(
    ['download', 'Add auth', '--out', '-'],
    makeDeps({ kind: 'found', plan }, cap),
  );
  expect(code).toBe(0);
  expect(cap.stdout).toEqual([plan.content]);
  expect(cap.written).toHaveLength(0);
});

test('reports not found and ambiguous matches', async () => {
  writeLoggedInConfig();
  const missing = newCapture();
  expect(
    await runDownload(
      ['download', 'Nope'],
      makeDeps({ kind: 'not_found', suggestions: [] }, missing),
    ),
  ).toBe(1);
  expect(missing.errors.join('\n')).toContain('no plan found');
  expect(missing.errors.join('\n')).not.toContain('closest matches');

  const ambiguous = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth'],
      makeDeps(
        {
          kind: 'ambiguous',
          matches: [
            {
              id: 'p1',
              agent: 'claude-code',
              title: 'Add auth',
              updatedAt: '2026-08-02T00:00:00.000Z',
            },
            {
              id: 'p2',
              agent: 'codex-cli',
              title: 'Add auth',
              updatedAt: '2026-08-03T00:00:00.000Z',
            },
          ],
        },
        ambiguous,
      ),
    ),
  ).toBe(1);
  expect(ambiguous.errors.join('\n')).toContain('multiple plans matched');
  expect(ambiguous.errors.join('\n')).toContain('[1] Add auth  (claude-code)');
  expect(ambiguous.errors.join('\n')).toContain('agendex download p1');
  expect(ambiguous.errors.join('\n')).toContain('[2] Add auth  (codex-cli)');
});

test('prints closest matches when a name lookup misses', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  expect(
    await runDownload(
      ['download', 'Add autth'],
      makeDeps(
        {
          kind: 'not_found',
          suggestions: [
            {
              id: 'p1',
              agent: 'claude-code',
              title: 'Add auth',
              updatedAt: '2026-08-02T00:00:00.000Z',
            },
            {
              id: 'p2',
              agent: 'codex-cli',
              title: 'Add authentication flow',
              updatedAt: '2026-08-03T00:00:00.000Z',
            },
          ],
        },
        cap,
      ),
    ),
  ).toBe(1);
  const errText = cap.errors.join('\n');
  expect(errText).toContain('no plan found for "Add autth"');
  expect(errText).toContain('closest matches — pick one without retyping the title:');
  expect(errText).toContain('[1] Add auth  (claude-code)');
  expect(errText).toContain('agendex download p1');
  expect(errText).toContain('[2] Add authentication flow  (codex-cli)');
  expect(errText).toContain('agendex download p2');
});

test('quick-selects a closest match and downloads it by id', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan();
  const suggestions = [
    {
      id: plan.id,
      agent: plan.agent,
      title: plan.title,
      updatedAt: plan.updatedAt,
    },
    {
      id: 'p2',
      agent: 'codex-cli',
      title: 'Add authentication flow',
      updatedAt: '2026-08-03T00:00:00.000Z',
    },
  ];

  const code = await runDownload(
    ['download', 'Add autth'],
    makeDeps(
      (query) => (query === plan.id ? { kind: 'found', plan } : { kind: 'not_found', suggestions }),
      cap,
      [],
      {
        canPrompt: () => true,
        promptSelect: async (matches, message) => {
          cap.prompted = { message, ids: matches.map((match) => match.id) };
          return plan.id;
        },
      },
    ),
  );

  expect(code).toBe(0);
  expect(cap.prompted).toEqual({
    message: 'Download which closest match?',
    ids: [plan.id, 'p2'],
  });
  expect(cap.queries.map((entry) => entry.query)).toEqual(['Add autth', plan.id]);
  expect(cap.written[0]?.content).toBe(plan.content);
});

test('cancelling quick-select does not download', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runDownload(
    ['download', 'Add autth'],
    makeDeps(
      {
        kind: 'not_found',
        suggestions: [
          {
            id: 'p1',
            agent: 'claude-code',
            title: 'Add auth',
            updatedAt: '2026-08-02T00:00:00.000Z',
          },
        ],
      },
      cap,
      [],
      {
        canPrompt: () => true,
        promptSelect: async () => null,
      },
    ),
  );

  expect(code).toBe(1);
  expect(cap.written).toHaveLength(0);
  expect(cap.queries).toHaveLength(1);
});

test('refuses to overwrite an existing file unless --force is passed', async () => {
  writeLoggedInConfig();
  const dest = join(dir, 'Add auth.md');
  const plan = samplePlan();

  const blocked = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth'],
      makeDeps({ kind: 'found', plan }, blocked, [], {}, [dest]),
    ),
  ).toBe(1);
  expect(blocked.written).toHaveLength(0);
  expect(blocked.errors.join('\n')).toContain(`${dest} already exists`);
  expect(blocked.errors.join('\n')).toContain('--force');

  const overwritten = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth', '--force'],
      makeDeps({ kind: 'found', plan }, overwritten, [], {}, [dest]),
    ),
  ).toBe(0);
  expect(overwritten.written).toEqual([{ path: dest, content: plan.content }]);
});

test('surfaces expired auth and generic cloud errors', async () => {
  writeLoggedInConfig();
  const expired = newCapture();
  expect(
    await runDownload(['download', 'Add auth'], makeDeps({ kind: 'auth-expired' }, expired)),
  ).toBe(1);
  expect(expired.errors.join('\n')).toContain('cloud token expired');

  const failed = newCapture();
  expect(
    await runDownload(
      ['download', 'Add auth'],
      makeDeps({ kind: 'error', status: 500, message: 'boom' }, failed),
    ),
  ).toBe(1);
  expect(failed.errors.join('\n')).toContain('boom');
});
