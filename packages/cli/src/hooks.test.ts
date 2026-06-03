import { afterEach, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not implemented yet'));
  } finally {
    errorSpy.mockRestore();
  }
});

test('claude-code hook install is gated behind preview opt-in', async () => {
  const repo = await useTempRepo();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(['hooks', 'install', 'claude-code'], './dist/cli.js');

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to install claude-code hook'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ExitPlanMode'));
    expect(logSpy).not.toHaveBeenCalled();
    expect(existsSync(join(repo, '.claude', 'hooks.json'))).toBe(false);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});

test('hooks install all does not install claude-code without preview opt-in', async () => {
  const repo = await useTempRepo();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(['hooks', 'install', 'all'], './dist/cli.js');

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to install claude-code hook'),
    );
    expect(logSpy).not.toHaveBeenCalled();
    expect(existsSync(join(repo, '.claude', 'hooks.json'))).toBe(false);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});

test('claude-code preview install writes hook with visible warning', async () => {
  const repo = await useTempRepo();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

  try {
    const result = await runHooksCommand(
      ['hooks', 'install', 'claude-code', '--preview'],
      './dist/cli.js',
    );

    const hookPath = join(repo, '.claude', 'hooks.json');
    const hookConfig = readFileSync(hookPath, 'utf-8');

    expect(result).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ExitPlanMode'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('installed claude-code hook'));
    expect(hookConfig).toContain('PermissionRequest');
    expect(hookConfig).toContain('ExitPlanMode');
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});
