import { afterEach, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDevMode, setDevMode } from '@agendex/shared';
import { runHookReviewCommand, runHooksCommand } from './hooks.ts';

const originalCwd = process.cwd();
const originalPwd = process.env.PWD;
let tempRoot: string | undefined;

async function useTempRepo(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-hooks-'));
  process.chdir(tempRoot);
  process.env.PWD = tempRoot;
  return tempRoot;
}

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalPwd === undefined) delete process.env.PWD;
  else process.env.PWD = originalPwd;

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

test('hook-native plan review fails closed until the review session server exists', async () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);

  try {
    const result = await runHookReviewCommand(['review-plan', '--hook', '--agent', 'codex']);

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('no supported plan-permission hook'),
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test('claude-code hook installs verified PermissionRequest gate in settings', async () => {
  const repo = await useTempRepo();
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    expect(await runHooksCommand(['hooks', 'install', 'claude-code'], './dist/cli.js')).toBe(0);
    const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PermissionRequest[0].matcher).toBe('ExitPlanMode');
    expect(settings.hooks.PermissionRequest[0].hooks[0].timeout).toBe(3610);
    expect(existsSync(join(repo, '.claude', 'hooks.json'))).toBe(false);
  } finally {
    logSpy.mockRestore();
  }
});

test('hooks install all installs nothing without preview opt-in', async () => {
  const repo = await useTempRepo();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(['hooks', 'install', 'all'], './dist/cli.js');

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to install codex hook'),
    );
    expect(logSpy).not.toHaveBeenCalled();
    expect(existsSync(join(repo, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(repo, '.codex', 'hooks.json'))).toBe(false);
    expect(existsSync(join(repo, '.pi'))).toBe(false);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});

test('codex hook install is gated behind preview opt-in', async () => {
  const repo = await useTempRepo();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(['hooks', 'install', 'codex'], './dist/cli.js');

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to install codex hook'),
    );
    expect(logSpy).not.toHaveBeenCalled();
    expect(existsSync(join(repo, '.codex', 'hooks.json'))).toBe(false);
    expect(existsSync(join(repo, '.codex', 'config.toml'))).toBe(false);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});

test('codex preview install warns, writes the Stop hook, and status flags it as preview-only', async () => {
  const repo = await useTempRepo();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(
      ['hooks', 'install', 'codex', '--preview'],
      './dist/cli.js',
    );

    expect(result).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING: codex'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported for plan approval'));
    expect(readFileSync(join(repo, '.codex', 'hooks.json'), 'utf-8')).toContain('Stop');

    logSpy.mockClear();
    expect(await runHooksCommand(['hooks', 'status'], './dist/cli.js')).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/codex: installed .*preview-only.*agendex hooks uninstall codex/),
    );
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});

test('claude-code install writes the actual settings hook', async () => {
  const repo = await useTempRepo();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(
      ['hooks', 'install', 'claude-code', '--preview'],
      './dist/cli.js',
    );

    const hookPath = join(repo, '.claude', 'settings.json');
    const hookConfig = readFileSync(hookPath, 'utf-8');

    expect(result).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('installed claude-code hook'));
    expect(hookConfig).toContain('PermissionRequest');
    expect(hookConfig).toContain('ExitPlanMode');
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});

test('claude-code install preserves unrelated ExitPlanMode hooks', async () => {
  const repo = await useTempRepo();
  const hookPath = join(repo, '.claude', 'settings.json');
  await mkdir(join(repo, '.claude'), { recursive: true });
  await writeFile(
    hookPath,
    JSON.stringify(
      {
        hooks: {
          PermissionRequest: [
            {
              matcher: 'ExitPlanMode',
              hooks: [{ type: 'command', command: 'custom-exit-plan-check' }],
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf-8',
  );

  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(
      ['hooks', 'install', 'claude-code', '--preview'],
      './dist/cli.js',
    );
    const hookConfig = JSON.parse(readFileSync(hookPath, 'utf-8')) as {
      hooks?: { PermissionRequest?: Array<{ id?: string; matcher?: string; hooks?: unknown[] }> };
    };
    const entries = hookConfig.hooks?.PermissionRequest ?? [];

    expect(result).toBe(0);
    expect(entries).toHaveLength(2);
    expect(
      entries.some((entry) => JSON.stringify(entry.hooks).includes('custom-exit-plan-check')),
    ).toBe(true);
    expect(entries.some((entry) => entry.id === 'agendex-plan-review')).toBe(true);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});

test('uninstall removes legacy hooks and preserves unrelated settings', async () => {
  const repo = await useTempRepo();
  await mkdir(join(repo, '.claude'), { recursive: true });
  await writeFile(
    join(repo, '.claude', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PermissionRequest: [
          { id: 'agendex-plan-review', hooks: [] },
          { id: 'custom', hooks: [] },
        ],
      },
    }),
  );
  await writeFile(
    join(repo, '.claude', 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      hooks: {
        PermissionRequest: [
          { id: 'agendex-plan-review', hooks: [] },
          { id: 'custom', hooks: [] },
        ],
      },
    }),
  );
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    expect(await runHooksCommand(['hooks', 'uninstall', 'claude-code'], './dist/cli.js')).toBe(0);
  } finally {
    logSpy.mockRestore();
  }
  expect(JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf-8')).theme).toBe(
    'dark',
  );
  expect(readFileSync(join(repo, '.claude', 'settings.json'), 'utf-8')).toContain('custom');
  expect(readFileSync(join(repo, '.claude', 'hooks.json'), 'utf-8')).not.toContain(
    'agendex-plan-review',
  );
});

test('installed Claude hook preserves dev configuration selection', async () => {
  const repo = await useTempRepo();
  const previousDev = isDevMode();
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    setDevMode(true);
    expect(
      await runHooksCommand(['--dev', 'hooks', 'install', 'claude-code'], './dist/cli.js'),
    ).toBe(0);
    const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PermissionRequest[0].hooks[0].command).toContain(
      ' --dev review-plan --hook',
    );
    setDevMode(false);
    expect(await runHooksCommand(['hooks', 'install', 'claude-code'], './dist/cli.js')).toBe(0);
    const normal = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf-8'));
    expect(normal.hooks.PermissionRequest[0].hooks[0].command).not.toContain('--dev');
  } finally {
    setDevMode(previousDev);
    logSpy.mockRestore();
  }
});
