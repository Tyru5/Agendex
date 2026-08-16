import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig } from '@agendex/shared';
import type {
  CloudPlanDownload,
  CloudPlanDownloadMatch,
  FetchCloudPlanResult,
  ListCloudPlansResult,
} from './api.ts';
import { runBrowse } from './browse.ts';
import type { BrowseAction } from './browse-prompt.ts';

let dir: string;
let prevConfigDir: string | undefined;
let prevPwd: string | undefined;
let prevInitCwd: string | undefined;

interface Capture {
  logs: string[];
  errors: string[];
  stdout: string[];
  written: { path: string; content: string }[];
  opened: string[];
  listQueries: { query?: string; agent?: string }[];
  fetches: { query: string; agent?: string }[];
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

function sampleMatch(overrides: Partial<CloudPlanDownloadMatch> = {}): CloudPlanDownloadMatch {
  return {
    id: 'plan-1',
    localPlanId: 'local-1',
    agent: 'claude-code',
    title: 'Add auth',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(
  cap: Capture,
  options: {
    list?: ListCloudPlansResult | ((query?: string, agent?: string) => ListCloudPlansResult);
    fetch?:
      | FetchCloudPlanResult
      | ((query: string, agent?: string) => FetchCloudPlanResult | Promise<FetchCloudPlanResult>);
    canPrompt?: () => boolean;
    promptSelectPlan?: (matches: CloudPlanDownloadMatch[]) => Promise<string | null>;
    promptSelectAction?: () => Promise<BrowseAction | null>;
    openLocalFile?: (path: string) => boolean;
    existingFiles?: string[];
    existingDirs?: string[];
  } = {},
) {
  const plan = samplePlan();
  return {
    listCloudPlans: async (opts: { query?: string; agent?: string }) => {
      cap.listQueries.push({ query: opts.query, agent: opts.agent });
      if (typeof options.list === 'function') return options.list(opts.query, opts.agent);
      return (
        options.list ?? {
          kind: 'ok' as const,
          plans: [sampleMatch()],
          continueCursor: null,
          isDone: true,
        }
      );
    },
    fetchCloudPlan: async (query: string, agent?: string) => {
      cap.fetches.push({ query, agent });
      return typeof options.fetch === 'function'
        ? await options.fetch(query, agent)
        : (options.fetch ?? { kind: 'found' as const, plan });
    },
    log: (message: string) => cap.logs.push(message),
    error: (message: string) => cap.errors.push(message),
    writeStdout: (content: string) => cap.stdout.push(content),
    writeFile: async (path: string, content: string) => {
      cap.written.push({ path, content });
    },
    mkdir: async () => undefined,
    stat: async (path: string) => {
      if (options.existingDirs?.includes(path)) {
        return { isDirectory: () => true } as Awaited<
          ReturnType<typeof import('node:fs/promises').stat>
        >;
      }
      if (options.existingFiles?.includes(path)) {
        return { isDirectory: () => false } as Awaited<
          ReturnType<typeof import('node:fs/promises').stat>
        >;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    canPrompt: options.canPrompt ?? (() => true),
    promptSelectPlan:
      options.promptSelectPlan ??
      (async (matches: CloudPlanDownloadMatch[]) => matches[0]?.id ?? null),
    promptSelectAction: options.promptSelectAction ?? (async () => 'save' as const),
    openLocalFile:
      options.openLocalFile ??
      ((path: string) => {
        cap.opened.push(path);
        return true;
      }),
  };
}

function newCapture(): Capture {
  return {
    logs: [],
    errors: [],
    stdout: [],
    written: [],
    opened: [],
    listQueries: [],
    fetches: [],
  };
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
  dir = mkdtempSync(join(tmpdir(), 'agendex-browse-'));
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

test('errors when --agent is missing its value', async () => {
  const cap = newCapture();
  const code = await runBrowse(['browse', '--agent'], makeDeps(cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('--agent requires a name');
});

test('errors when --format is missing its value', async () => {
  const cap = newCapture();
  const code = await runBrowse(['browse', '--format'], makeDeps(cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('--format requires md or html');
});

test('errors when --out is missing its value', async () => {
  const cap = newCapture();
  const code = await runBrowse(['browse', '--out'], makeDeps(cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('--out requires a path');
});

test('requires a TTY', async () => {
  const cap = newCapture();
  const code = await runBrowse(['browse'], makeDeps(cap, { canPrompt: () => false }));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('interactive browse requires a TTY');
  expect(cap.errors.join('\n')).toContain('agendex download');
});

test('errors when not logged in', async () => {
  const cap = newCapture();
  const code = await runBrowse(['browse'], makeDeps(cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('not logged in');
});

test('rejects pdf format', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(['browse', '--format', 'pdf'], makeDeps(cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('PDF download is available in the web app');
});

test('errors when the cloud list is empty', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: { kind: 'ok', plans: [], continueCursor: null, isDone: true },
    }),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('no cloud plans found');
});

test('passes optional filter and agent to the list API', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  await runBrowse(
    ['browse', 'claude-code/Add auth'],
    makeDeps(cap, {
      promptSelectPlan: async () => null,
    }),
  );
  expect(cap.listQueries).toEqual([{ query: 'Add auth', agent: 'claude-code' }]);
});

test('views markdown then saves the selected plan', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const plan = samplePlan();
  let actionCalls = 0;
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      fetch: { kind: 'found', plan },
      promptSelectAction: async () => {
        actionCalls += 1;
        return actionCalls === 1 ? 'view' : 'save';
      },
    }),
  );
  expect(code).toBe(0);
  expect(cap.logs.join('\n')).toContain('viewing "Add auth"');
  expect(cap.stdout.join('')).toBe(plan.content);
  expect(cap.written[0]?.path).toBe(join(dir, 'Add auth.md'));
  expect(cap.written[0]?.content).toBe(plan.content);
  expect(cap.opened).toHaveLength(0);
});

test('opens the written file after save', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      promptSelectAction: async () => 'open',
    }),
  );
  expect(code).toBe(0);
  expect(cap.written[0]?.path).toBe(join(dir, 'Add auth.md'));
  expect(cap.opened).toEqual([join(dir, 'Add auth.md')]);
  expect(cap.logs.join('\n')).toContain(`opening ${join(dir, 'Add auth.md')}`);
});

test('does not open when --out is stdout', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse', '--out', '-'],
    makeDeps(cap, {
      promptSelectAction: async () => 'open',
    }),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('cannot open a plan written to stdout');
  expect(cap.opened).toHaveLength(0);
});

test('honors --force when saving over an existing file', async () => {
  writeLoggedInConfig();
  const dest = join(dir, 'Add auth.md');
  const blocked = newCapture();
  expect(
    await runBrowse(
      ['browse'],
      makeDeps(blocked, {
        existingFiles: [dest],
        promptSelectAction: async () => 'save',
      }),
    ),
  ).toBe(1);
  expect(blocked.errors.join('\n')).toContain('already exists');

  const forced = newCapture();
  expect(
    await runBrowse(
      ['browse', '--force'],
      makeDeps(forced, {
        existingFiles: [dest],
        promptSelectAction: async () => 'save',
      }),
    ),
  ).toBe(0);
  expect(forced.written[0]?.path).toBe(dest);
});

test('returns cancelled when the plan picker is dismissed', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      promptSelectPlan: async () => null,
    }),
  );
  expect(code).toBe(1);
  expect(cap.written).toHaveLength(0);
});

test('returns cancelled when the action picker is dismissed', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      promptSelectAction: async () => null,
    }),
  );
  expect(code).toBe(1);
  expect(cap.written).toHaveLength(0);
});

test('maps expired cloud auth from the list API', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(['browse'], makeDeps(cap, { list: { kind: 'auth-expired' } }));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('cloud token expired');
});

test('prints a list API error message', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: { kind: 'error', status: 404, message: 'Cloud browse is not available' },
    }),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('Cloud browse is not available');
});
