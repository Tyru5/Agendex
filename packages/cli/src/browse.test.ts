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
  listQueries: { query?: string; agent?: string; cursor?: string }[];
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
    list?:
      | ListCloudPlansResult
      | ((opts: { query?: string; agent?: string; cursor?: string }) => ListCloudPlansResult);
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
    listCloudPlans: async (opts: { query?: string; agent?: string; cursor?: string }) => {
      cap.listQueries.push({ query: opts.query, agent: opts.agent, cursor: opts.cursor });
      if (typeof options.list === 'function') return options.list(opts);
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
  expect(cap.listQueries).toEqual([{ query: 'Add auth', agent: 'claude-code', cursor: undefined }]);
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

test('pages through continueCursor until the list is complete', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const first = sampleMatch({ id: 'plan-1', title: 'Add auth' });
  const second = sampleMatch({ id: 'plan-2', title: 'Ship browse' });
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        if (!opts.cursor) {
          return {
            kind: 'ok',
            plans: [first],
            continueCursor: 'page-2',
            isDone: false,
          };
        }
        return {
          kind: 'ok',
          plans: [second],
          continueCursor: null,
          isDone: true,
        };
      },
      promptSelectPlan: async (matches) => {
        expect(matches.map((match) => match.id)).toEqual(['plan-1', 'plan-2']);
        return null;
      },
    }),
  );
  expect(code).toBe(1);
  expect(cap.listQueries.map((query) => query.cursor)).toEqual([undefined, 'page-2']);
});

test('collapses the same logical plan served on different pages', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const stale = sampleMatch({
    id: 'plan-old',
    title: 'Add auth',
    dedupeKeys: ['sync:auth'],
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  const fresh = sampleMatch({
    id: 'plan-new',
    title: 'Add auth',
    dedupeKeys: ['sync:auth'],
    updatedAt: '2026-08-03T00:00:00.000Z',
  });
  const other = sampleMatch({ id: 'plan-2', title: 'Ship browse', dedupeKeys: ['id:plan-2'] });
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        if (!opts.cursor) {
          return { kind: 'ok', plans: [stale], continueCursor: 'page-2', isDone: false };
        }
        return { kind: 'ok', plans: [fresh, other], continueCursor: null, isDone: true };
      },
      promptSelectPlan: async (matches) => {
        expect(matches.map((match) => match.id)).toEqual(['plan-new', 'plan-2']);
        return null;
      },
    }),
  );
  expect(code).toBe(1);
});

test('collapses a synced row with an exact duplicate that lacks a sync identity', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const synced = sampleMatch({
    id: 'plan-synced',
    dedupeKeys: ['sync:auth', 'exact:claude|add auth|hash-1'],
    updatedAt: '2026-08-03T00:00:00.000Z',
  });
  const unsynced = sampleMatch({
    id: 'plan-unsynced',
    dedupeKeys: ['exact:claude|add auth|hash-1'],
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        if (!opts.cursor) {
          return { kind: 'ok', plans: [synced], continueCursor: 'page-2', isDone: false };
        }
        return { kind: 'ok', plans: [unsynced], continueCursor: null, isDone: true };
      },
      promptSelectPlan: async (matches) => {
        expect(matches.map((match) => match.id)).toEqual(['plan-synced']);
        return null;
      },
    }),
  );
  expect(code).toBe(1);
});

test('folds an unsynced row matching an identity discarded by page dedupe', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  // Page dedupe on the server kept the fresher synced row, but its dedupeKeys
  // carry the discarded older version's exact-content key too.
  const winner = sampleMatch({
    id: 'plan-winner',
    dedupeKeys: [
      'sync:auth',
      'exact:claude|add auth|hash-new',
      'exact:claude|add auth|hash-old',
    ],
    updatedAt: '2026-08-03T00:00:00.000Z',
  });
  const unsyncedOld = sampleMatch({
    id: 'plan-unsynced',
    dedupeKeys: ['exact:claude|add auth|hash-old'],
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        if (!opts.cursor) {
          return { kind: 'ok', plans: [winner], continueCursor: 'page-2', isDone: false };
        }
        return { kind: 'ok', plans: [unsyncedOld], continueCursor: null, isDone: true };
      },
      promptSelectPlan: async (matches) => {
        expect(matches.map((match) => match.id)).toEqual(['plan-winner']);
        return null;
      },
    }),
  );
  expect(code).toBe(1);
});

test('folds two accumulated groups when a later row bridges them', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const syncOnly = sampleMatch({
    id: 'plan-sync',
    dedupeKeys: ['sync:auth'],
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  const exactOnly = sampleMatch({
    id: 'plan-exact',
    dedupeKeys: ['exact:claude|add auth|hash-1'],
    updatedAt: '2026-08-02T00:00:00.000Z',
  });
  const bridge = sampleMatch({
    id: 'plan-bridge',
    dedupeKeys: ['sync:auth', 'exact:claude|add auth|hash-1'],
    updatedAt: '2026-08-03T00:00:00.000Z',
  });
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        if (!opts.cursor) {
          return {
            kind: 'ok',
            plans: [syncOnly, exactOnly],
            continueCursor: 'page-2',
            isDone: false,
          };
        }
        return { kind: 'ok', plans: [bridge], continueCursor: null, isDone: true };
      },
      promptSelectPlan: async (matches) => {
        expect(matches.map((match) => match.id)).toEqual(['plan-bridge']);
        return null;
      },
    }),
  );
  expect(code).toBe(1);
});

test('breaks equal-updatedAt duplicate ties by createdAt like the server', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const olderCreation = sampleMatch({
    id: 'plan-old',
    dedupeKeys: ['sync:auth'],
    updatedAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const newerCreation = sampleMatch({
    id: 'plan-new',
    dedupeKeys: ['sync:auth'],
    updatedAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-01T12:00:00.000Z',
  });
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        if (!opts.cursor) {
          return { kind: 'ok', plans: [olderCreation], continueCursor: 'page-2', isDone: false };
        }
        return { kind: 'ok', plans: [newerCreation], continueCursor: null, isDone: true };
      },
      promptSelectPlan: async (matches) => {
        expect(matches.map((match) => match.id)).toEqual(['plan-new']);
        return null;
      },
    }),
  );
  expect(code).toBe(1);
});

test('keeps paging past ten pages so later plans are not omitted', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const pages = Array.from({ length: 12 }, (_, i) =>
    sampleMatch({ id: `plan-${i + 1}`, title: `Plan ${i + 1}` }),
  );
  const last = pages.at(-1);
  if (!last) throw new Error('expected browse pages');
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        const index = opts.cursor ? Number(opts.cursor) : 0;
        const plan = pages[index];
        if (!plan) throw new Error(`missing browse page ${index}`);
        const next = index + 1;
        const done = next >= pages.length;
        return {
          kind: 'ok' as const,
          plans: [plan],
          continueCursor: done ? null : String(next),
          isDone: done,
        };
      },
      promptSelectPlan: async (matches) => {
        expect(matches.map((match) => match.id)).toEqual(pages.map((plan) => plan.id));
        return last.id;
      },
    }),
  );
  expect(code).toBe(0);
  expect(cap.listQueries).toHaveLength(pages.length);
});

test('errors when pagination cursor does not advance', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: () => ({
        kind: 'ok',
        plans: [sampleMatch()],
        continueCursor: 'stuck',
        isDone: false,
      }),
    }),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('pagination did not advance');
});

test('keeps paging when an early page is empty so later matches are not missed', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const later = sampleMatch({ id: 'plan-9', title: 'Later plan' });
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      list: (opts) => {
        if (!opts.cursor) {
          return { kind: 'ok', plans: [], continueCursor: 'page-2', isDone: false };
        }
        return { kind: 'ok', plans: [later], continueCursor: null, isDone: true };
      },
    }),
  );
  expect(code).toBe(0);
  expect(cap.written[0]?.path).toContain('Add auth.md');
});

test('reports an opener failure instead of pretending the file opened', async () => {
  writeLoggedInConfig();
  const cap = newCapture();
  const code = await runBrowse(
    ['browse'],
    makeDeps(cap, {
      promptSelectAction: async () => 'open',
      openLocalFile: () => false,
    }),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('could not open the file on this machine');
  expect(cap.logs.join('\n')).not.toContain('opening ');
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
