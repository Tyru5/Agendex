import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import type { FilePlanHistory } from '@agendex/shared/file-plan-history';
import { parseWhyArgs, renderFilePlanHistory, runWhyCommand } from './why.ts';

const history: FilePlanHistory = {
  path: 'src/auth.ts',
  workspace: '/repo',
  total: 2,
  limit: 1,
  offset: 0,
  plans: [
    {
      id: 'p1',
      title: 'Fix auth',
      agent: 'claude-code',
      filePath: '/plans/auth.md',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      mentioned: false,
      changedByPlanCommits: true,
      receipt: {
        planId: 'p1',
        status: 'landed',
        confidence: 'medium',
        changedFiles: 1,
        mentionedFiles: 1,
        commits: 1,
      },
    },
  ],
};

test('why accepts paths with spaces, workspace and bounded JSON output', () => {
  expect(
    parseWhyArgs(['src/auth flow.ts', '--workspace', '/repo', '--limit', '2', '--json']),
  ).toEqual({
    path: 'src/auth flow.ts',
    workspace: '/repo',
    limit: 2,
    json: true,
  });
  expect(parseWhyArgs(['--dev', '--', '-auth.ts']).path).toBe('-auth.ts');
});

test('why rejects missing paths, extra paths, unknown flags and invalid limits', () => {
  for (const args of [
    [],
    [' '],
    ['a.ts', 'b.ts'],
    ['a.ts', '--wat'],
    ['a.ts', '--workspace'],
    ['a.ts', '--workspace', ' '],
    ['a.ts', '--limit', '0'],
    ['a.ts', '--limit', '101'],
    ['a.ts', '--limit', '1.5'],
    ['a.ts', '--limit', 'NaN'],
  ]) {
    expect(() => parseWhyArgs(args)).toThrow();
  }
});

test('why labels commit-only matches without claiming they were planned', () => {
  const output = renderFilePlanHistory(history);
  expect(output).toContain('changed by attributed commits');
  expect(output).not.toContain('mentioned in plan');
  expect(output).toContain('landed');
  expect(output).toContain('Attribution confidence: medium');
  expect(output).toContain('Showing 1 of 2');
});

test('why strips terminal controls from indexed titles and paths', () => {
  const fixture = history.plans[0];
  if (!fixture) throw new Error('Missing fixture');
  const output = renderFilePlanHistory({
    ...history,
    path: '\u001b[2Jauth.ts',
    plans: [
      {
        ...fixture,
        title: 'Fix\u001b[2J auth',
        filePath: '/plans/auth\n.md',
      },
    ],
  });
  expect(output).not.toContain('\u001b');
  expect(output).not.toContain('auth\n.md');
});

test('why emits one JSON document and applies workspace during indexing and lookup', async () => {
  const previousCwd = process.cwd();
  const output: string[] = [];
  const errors: string[] = [];
  let scannedCwd: string | undefined;
  const code = await runWhyCommand(['src/auth.ts', '--workspace', tmpdir(), '--json'], {
    initialize: async () => {
      scannedCwd = process.cwd();
    },
    lookup: async (path, options) => {
      expect(path).toBe('src/auth.ts');
      expect(options?.cwd).toBe(scannedCwd);
      return history;
    },
    stdout: (text) => output.push(text),
    stderr: (text) => errors.push(text),
  });
  expect(code).toBe(0);
  expect(output).toHaveLength(1);
  expect(JSON.parse(output[0] ?? '')).toEqual(history);
  expect(errors).toEqual([]);
  expect(process.cwd()).toBe(previousCwd);
});

test('why does not scan when arguments are invalid', async () => {
  let scanned = false;
  const errors: string[] = [];
  const code = await runWhyCommand([], {
    initialize: async () => {
      scanned = true;
    },
    lookup: async () => history,
    stdout: () => {},
    stderr: (text) => errors.push(text),
  });
  expect(code).toBe(1);
  expect(scanned).toBe(false);
  expect(errors.join('\n')).toContain('usage: agendex why');
});

test('why reports lookup failures and restores the working directory', async () => {
  const previousCwd = process.cwd();
  const errors: string[] = [];
  const code = await runWhyCommand(['a.ts', '--workspace', tmpdir()], {
    initialize: async () => {},
    lookup: async () => {
      throw new Error('lookup failed');
    },
    stdout: () => {
      throw new Error('Unexpected output');
    },
    stderr: (text) => errors.push(text),
  });
  expect(code).toBe(1);
  expect(errors).toEqual(['[agendex] lookup failed']);
  expect(process.cwd()).toBe(previousCwd);
});

test('why treats an empty match set as a successful lookup', async () => {
  const output: string[] = [];
  const code = await runWhyCommand(['a.ts'], {
    initialize: async () => {},
    lookup: async () => ({ ...history, total: 0, plans: [] }),
    stdout: (text) => output.push(text),
    stderr: () => {},
  });
  expect(code).toBe(0);
  expect(output[0]).toContain('No indexed plans');
});
