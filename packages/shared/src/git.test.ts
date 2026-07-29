import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captureGitContext,
  clearGitContextCache,
  findGitRoot,
  getPlanGitContext,
  resolvePlanRepoRoot,
} from './git.ts';

let baseDir: string;
let repoDir: string;
let nonRepoDir: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'agendex-git-test-'));

  repoDir = join(baseDir, 'repo');
  mkdirSync(join(repoDir, 'nested', 'deep'), { recursive: true });
  git(repoDir, 'init', '--initial-branch=feat/git-links');
  git(repoDir, 'config', 'user.email', 'test@example.com');
  git(repoDir, 'config', 'user.name', 'Test');
  // Use a host that no global `url.<base>.insteadOf` rewrite (e.g. CI token
  // injection for github.com) will touch, so `remote get-url` is stable.
  git(
    repoDir,
    'remote',
    'add',
    'origin',
    'https://user:token@gitforge.example.test/acme/widgets.git',
  );
  writeFileSync(join(repoDir, 'README.md'), '# repo\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-m', 'init', '--no-gpg-sign');

  nonRepoDir = join(baseDir, 'plain');
  mkdirSync(nonRepoDir, { recursive: true });
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearGitContextCache();
});

describe('findGitRoot', () => {
  test('finds the repo root from nested directories', () => {
    expect(findGitRoot(join(repoDir, 'nested', 'deep'))).toBe(repoDir);
    expect(findGitRoot(repoDir)).toBe(repoDir);
  });

  test('returns null outside a repository', () => {
    expect(findGitRoot(nonRepoDir)).toBeNull();
  });
});

describe('resolvePlanRepoRoot', () => {
  test('prefers the workspace directory', () => {
    expect(resolvePlanRepoRoot({ workspace: join(repoDir, 'nested') })).toBe(repoDir);
  });

  test('falls back to the plan file directory', () => {
    expect(resolvePlanRepoRoot({ filePath: join(repoDir, 'nested', 'deep', 'plan.md') })).toBe(
      repoDir,
    );
  });

  test('returns null when neither resolves to a repo', () => {
    expect(resolvePlanRepoRoot({ workspace: nonRepoDir })).toBeNull();
    expect(resolvePlanRepoRoot({})).toBeNull();
  });
});

describe('captureGitContext', () => {
  test('captures branch, commit, and a credential-stripped remote', () => {
    const context = captureGitContext(repoDir);
    expect(context).not.toBeNull();
    expect(context?.branch).toBe('feat/git-links');
    expect(context?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(context?.remoteUrl).toBe('https://gitforge.example.test/acme/widgets.git');
    expect(context?.repo).toEqual({
      host: 'gitforge.example.test',
      owner: 'acme',
      name: 'widgets',
      webUrl: 'https://gitforge.example.test/acme/widgets',
    });
  });

  test('returns null for a non-repo directory', () => {
    expect(captureGitContext(nonRepoDir)).toBeNull();
  });
});

describe('getPlanGitContext', () => {
  test('resolves context via workspace and caches per repo root', () => {
    const first = getPlanGitContext({ workspace: repoDir });
    const second = getPlanGitContext({
      workspace: repoDir,
      filePath: join(repoDir, 'nested', 'plan.md'),
    });
    expect(first?.branch).toBe('feat/git-links');
    expect(second).toEqual(first);
  });

  test('returns null when there is nothing to resolve', () => {
    expect(getPlanGitContext({})).toBeNull();
    expect(getPlanGitContext({ workspace: nonRepoDir })).toBeNull();
  });
});
