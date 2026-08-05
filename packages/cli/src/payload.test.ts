import { afterAll, beforeAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clearGitContextCache, computeContentHash, hashPath, type Plan } from '@agendex/shared';
import { fileToSyncPayload, parseUploadFile, planToSyncPayload } from './payload.ts';

let gitRepoDir = '';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

beforeAll(() => {
  gitRepoDir = mkdtempSync(join(tmpdir(), 'agendex-payload-git-'));
  git(gitRepoDir, 'init', '--initial-branch=feat/linked');
  git(gitRepoDir, 'config', 'user.email', 'test@example.com');
  git(gitRepoDir, 'config', 'user.name', 'Test');
  // Host chosen so global insteadOf rewrites (e.g. CI github.com token injection) never apply.
  git(gitRepoDir, 'remote', 'add', 'origin', 'https://gitforge.example.test/acme/widgets.git');
  writeFileSync(join(gitRepoDir, 'README.md'), 'hi\n');
  git(gitRepoDir, 'add', '.');
  git(gitRepoDir, 'commit', '-m', 'init', '--no-gpg-sign');
  mkdirSync(join(gitRepoDir, 'plans'), { recursive: true });
  clearGitContextCache();
});

afterAll(() => {
  if (gitRepoDir) rmSync(gitRepoDir, { recursive: true, force: true });
});

function planInGitRepo(): Plan {
  return {
    id: 'local-git',
    agent: 'codex',
    title: 'Plan',
    content: '# Plan',
    filePath: join(gitRepoDir, 'plans', 'plan.md'),
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    workspace: gitRepoDir,
    metadata: {},
  };
}

test('planToSyncPayload preserves metadata and records the syncing daemon device', () => {
  const plan: Plan = {
    id: 'local-1',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: {
      source: 'plannotator',
      agendexSync: { previous: true },
    },
  };

  const payload = planToSyncPayload(plan, 'device-1', 'my-laptop', '192.168.1.42');

  expect(payload.metadata).toEqual({
    source: 'plannotator',
    agendexSync: {
      previous: true,
      deviceId: 'device-1',
      hostname: 'my-laptop',
      ipAddress: '192.168.1.42',
    },
  });
  expect(plan.metadata).toEqual({
    source: 'plannotator',
    agendexSync: { previous: true },
  });
});

test('planToSyncPayload omits sync metadata when no provenance fields provided', () => {
  const plan: Plan = {
    id: 'local-2',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: { source: 'plannotator' },
  };

  const payload = planToSyncPayload(plan);

  expect(payload.metadata).toEqual({ source: 'plannotator' });
});

test('planToSyncPayload records ipAddress even when hostname/deviceId are absent', () => {
  const plan: Plan = {
    id: 'local-3',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: {},
  };

  const payload = planToSyncPayload(plan, undefined, undefined, '10.0.0.5');

  expect(payload.metadata).toEqual({
    agendexSync: { ipAddress: '10.0.0.5' },
  });
});

test('parseUploadFile derives title from first heading', () => {
  const r = parseUploadFile('/tmp/my-plan.md', '# Real Title\n\nBody text');
  expect(r.title).toBe('Real Title');
  expect(r.body).toBe('# Real Title\n\nBody text');
});

test('parseUploadFile falls back to filename when no heading', () => {
  const r = parseUploadFile('/tmp/my-plan.md', 'Just some body without heading');
  expect(r.title).toBe('my-plan');
});

test('parseUploadFile reads agent from frontmatter and strips it from body', () => {
  const content = '---\nagent: codex\n---\n# Titled\n\nBody';
  const r = parseUploadFile('/tmp/p.md', content);
  expect(r.agent).toBe('codex');
  expect(r.title).toBe('Titled');
  expect(r.body).toBe('# Titled\n\nBody');
});

test('parseUploadFile prefers agent override over frontmatter', () => {
  const content = '---\nagent: codex\n---\n# Titled';
  const r = parseUploadFile('/tmp/p.md', content, 'cursor');
  expect(r.agent).toBe('cursor');
});

test('parseUploadFile uses agent override when no frontmatter', () => {
  const r = parseUploadFile('/tmp/p.md', '# Titled', 'cursor');
  expect(r.agent).toBe('cursor');
});

test("parseUploadFile defaults agent to 'uploaded'", () => {
  const r = parseUploadFile('/tmp/p.md', '# Titled');
  expect(r.agent).toBe('uploaded');
});

test('fileToSyncPayload derives localPlanId from absolute path hash', () => {
  // fileToSyncPayload resolves its input, so the expectations must resolve too:
  // on Windows '/tmp/abs/plan.md' resolves to 'C:\tmp\abs\plan.md'.
  const inputPath = '/tmp/abs/plan.md';
  const absolutePath = resolve(inputPath);
  const payload = fileToSyncPayload(inputPath, '# Plan\n\nbody', {
    createdAt: 100,
    updatedAt: 200,
  });
  expect(payload.localPlanId).toBe(hashPath(absolutePath));
  expect(payload.format).toBe('md');
  expect(payload.title).toBe('Plan');
  expect(payload.content).toBe('# Plan\n\nbody');
  expect(payload.createdAt).toBe(100);
  expect(payload.updatedAt).toBe(200);
  expect(payload.filePath).toBe(absolutePath);
});

test('fileToSyncPayload records upload provenance metadata', () => {
  const payload = fileToSyncPayload('/tmp/abs/plan.md', '# Plan', {
    deviceId: 'dev-1',
    hostname: 'box',
  });
  expect(payload.metadata).toEqual({
    uploaded: true,
    userCreated: true,
    planValueOverride: 'manual',
    agendexSync: { deviceId: 'dev-1', hostname: 'box' },
  });
});

test('planToSyncPayload enriches metadata.git from the plan workspace', () => {
  const payload = planToSyncPayload(planInGitRepo());

  const git = payload.metadata?.git as Record<string, unknown>;
  expect(git.branch).toBe('feat/linked');
  expect(git.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(git.remoteUrl).toBe('https://gitforge.example.test/acme/widgets.git');
  expect(git.repo).toEqual({
    host: 'gitforge.example.test',
    owner: 'acme',
    name: 'widgets',
    webUrl: 'https://gitforge.example.test/acme/widgets',
  });
});

test('planToSyncPayload leaves plans outside a repo and sync identity untouched', () => {
  const outside: Plan = { ...planInGitRepo(), workspace: undefined, filePath: '/tmp/plan.md' };
  expect(planToSyncPayload(outside).metadata?.git).toBeUndefined();

  const enriched = planToSyncPayload(planInGitRepo());
  expect(enriched.contentHash).toBe(
    computeContentHash({ title: 'Plan', content: '# Plan', format: 'md' }),
  );
});

test('planToSyncPayload skips git enrichment when AGENDEX_DISABLE_GIT_CONTEXT=1', () => {
  process.env.AGENDEX_DISABLE_GIT_CONTEXT = '1';
  try {
    expect(planToSyncPayload(planInGitRepo()).metadata?.git).toBeUndefined();
  } finally {
    delete process.env.AGENDEX_DISABLE_GIT_CONTEXT;
  }
});

test('fileToSyncPayload enriches metadata.git for uploads inside a repo', () => {
  const filePath = join(gitRepoDir, 'plans', 'uploaded.md');
  const payload = fileToSyncPayload(filePath, '# Uploaded');
  const git = payload.metadata?.git as Record<string, unknown>;
  expect(git.branch).toBe('feat/linked');
  expect(payload.workspace).toBe(gitRepoDir);
});
