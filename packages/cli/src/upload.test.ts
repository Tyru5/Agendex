import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig } from '@agendex/shared';
import type { SyncPlanResult, SyncPlanPayload } from './api.ts';
import { runUpload } from './upload.ts';

let dir: string;
let prevConfigDir: string | undefined;
let prevSiteUrl: string | undefined;

interface Capture {
  logs: string[];
  errors: string[];
  opened: { url: string; label: string }[];
  lastPayload?: SyncPlanPayload;
}

function makeDeps(result: SyncPlanResult, cap: Capture) {
  return {
    syncPlan: async (plan: SyncPlanPayload) => {
      cap.lastPayload = plan;
      return result;
    },
    log: (m: string) => cap.logs.push(m),
    error: (m: string) => cap.errors.push(m),
    openBrowser: (url: string, label: string) => cap.opened.push({ url, label }),
  };
}

function newCapture(): Capture {
  return { logs: [], errors: [], opened: [] };
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
  dir = mkdtempSync(join(tmpdir(), 'agendex-upload-'));
  prevConfigDir = process.env.AGENDEX_CONFIG_DIR;
  prevSiteUrl = process.env.AGENDEX_SITE_URL;
  process.env.AGENDEX_CONFIG_DIR = join(dir, 'config');
  process.env.AGENDEX_SITE_URL = 'https://app.agendex.dev';
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = prevConfigDir;
  if (prevSiteUrl === undefined) delete process.env.AGENDEX_SITE_URL;
  else process.env.AGENDEX_SITE_URL = prevSiteUrl;
  rmSync(dir, { recursive: true, force: true });
});

test('errors when no path argument provided', async () => {
  const cap = newCapture();
  const code = await runUpload(['upload'], makeDeps({ ok: true }, cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('usage: agendex upload');
});

test('errors when path does not exist', async () => {
  const cap = newCapture();
  const code = await runUpload(['upload', join(dir, 'missing.md')], makeDeps({ ok: true }, cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('does not exist');
});

test('errors when path is a directory', async () => {
  const cap = newCapture();
  const code = await runUpload(['upload', dir], makeDeps({ ok: true }, cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('directory');
});

test('errors for non-markdown file', async () => {
  const f = join(dir, 'note.txt');
  writeFileSync(f, 'hello');
  const cap = newCapture();
  const code = await runUpload(['upload', f], makeDeps({ ok: true }, cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('.md');
});

test('fails fast when not logged in', async () => {
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# Plan');
  const cap = newCapture();
  const code = await runUpload(['upload', f], makeDeps({ ok: true }, cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('agendex login');
});

test('403 surfaces server message and a pricing link', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# Plan');
  const cap = newCapture();
  const code = await runUpload(
    ['upload', f],
    makeDeps({ ok: false, status: 403, error: '403: Cloud Pro subscription required' }, cap),
  );
  expect(code).toBe(1);
  const errText = cap.errors.join('\n');
  expect(errText).toContain('Cloud Pro subscription required');
  expect(errText).toContain('/#pricing');
});

test('generic failure exits non-zero', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# Plan');
  const cap = newCapture();
  const code = await runUpload(
    ['upload', f],
    makeDeps({ ok: false, status: 500, error: '500: boom' }, cap),
  );
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('upload failed');
});

test('low-value skip prints explicit notice and exits 0', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# Plan');
  const cap = newCapture();
  const code = await runUpload(['upload', f], makeDeps({ ok: true, skippedLowValue: true }, cap));
  expect(code).toBe(0);
  expect(cap.logs.join('\n')).toContain('low-value');
  expect(cap.logs.join('\n')).toContain('not stored');
});

test('success prints title and direct dashboard plan URL', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# My Title\n\nbody');
  const cap = newCapture();
  const code = await runUpload(['upload', f], makeDeps({ ok: true, planId: 'plan_123' }, cap));
  expect(code).toBe(0);
  const logText = cap.logs.join('\n');
  expect(logText).toContain('uploaded "My Title"');
  expect(logText).toContain('https://app.agendex.dev/dashboard?plan=plan_123');
  expect(cap.opened).toHaveLength(0);
});

test('success without planId falls back to dashboard URL', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# T');
  const cap = newCapture();
  const code = await runUpload(['upload', f], makeDeps({ ok: true }, cap));
  expect(code).toBe(0);
  const logText = cap.logs.join('\n');
  expect(logText).toContain('https://app.agendex.dev/dashboard');
  expect(logText).not.toContain('?plan=');
});

test('--open launches the direct plan URL', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# T');
  const cap = newCapture();
  const code = await runUpload(['upload', f, '--open'], makeDeps({ ok: true, planId: 'pid' }, cap));
  expect(code).toBe(0);
  expect(cap.opened).toHaveLength(1);
  expect(cap.opened[0]?.url).toBe('https://app.agendex.dev/dashboard?plan=pid');
});

test('success uses stored login site URL for dashboard links', async () => {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    convexUrl: 'https://example.convex.cloud',
    siteUrl: 'https://self-hosted.example.com',
  });
  delete process.env.AGENDEX_SITE_URL;
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# My Title\n\nbody');
  const cap = newCapture();
  const code = await runUpload(['upload', f], makeDeps({ ok: true, planId: 'plan_123' }, cap));
  expect(code).toBe(0);
  const logText = cap.logs.join('\n');
  expect(logText).toContain('https://self-hosted.example.com/dashboard?plan=plan_123');
});

test('success prefers stored login site URL over AGENDEX_SITE_URL', async () => {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    convexUrl: 'https://example.convex.cloud',
    siteUrl: 'https://self-hosted.example.com',
  });
  process.env.AGENDEX_SITE_URL = 'https://app.agendex.dev';
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# My Title\n\nbody');
  const cap = newCapture();
  const code = await runUpload(['upload', f], makeDeps({ ok: true, planId: 'plan_123' }, cap));
  expect(code).toBe(0);
  const logText = cap.logs.join('\n');
  expect(logText).toContain('https://self-hosted.example.com/dashboard?plan=plan_123');
  expect(logText).not.toContain('https://app.agendex.dev/dashboard?plan=plan_123');
});

test('expands tilde in upload path', async () => {
  writeLoggedInConfig();
  const homePlanDir = join(homedir(), `.agendex-upload-tilde-${Date.now()}`);
  mkdirSync(homePlanDir, { recursive: true });
  const f = join(homePlanDir, 'plan.md');
  writeFileSync(f, '# Tilde Plan');
  const cap = newCapture();
  try {
    const tildePath = `~${homePlanDir.slice(homedir().length)}/plan.md`;
    const code = await runUpload(['upload', tildePath], makeDeps({ ok: true }, cap));
    expect(code).toBe(0);
    expect(cap.lastPayload?.filePath).toBe(f);
  } finally {
    rmSync(homePlanDir, { recursive: true, force: true });
  }
});

test('--agent override wins over frontmatter agent', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '---\nagent: codex\n---\n# T');
  const cap = newCapture();
  await runUpload(['upload', f, '--agent', 'cursor'], makeDeps({ ok: true }, cap));
  expect(cap.lastPayload?.agent).toBe('cursor');
});

test('--agent override is applied to the payload', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# T');
  const cap = newCapture();
  await runUpload(['upload', f, '--agent', 'cursor'], makeDeps({ ok: true }, cap));
  expect(cap.lastPayload?.agent).toBe('cursor');
});

test('errors when --agent is missing a value before --open', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# T');
  const cap = newCapture();
  const code = await runUpload(['upload', f, '--agent', '--open'], makeDeps({ ok: true }, cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('--agent requires a name');
  expect(cap.lastPayload).toBeUndefined();
});

test('errors when --agent is the last argument', async () => {
  writeLoggedInConfig();
  const f = join(dir, 'plan.md');
  writeFileSync(f, '# T');
  const cap = newCapture();
  const code = await runUpload(['upload', f, '--agent'], makeDeps({ ok: true }, cap));
  expect(code).toBe(1);
  expect(cap.errors.join('\n')).toContain('--agent requires a name');
});
