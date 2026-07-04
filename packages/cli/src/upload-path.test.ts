import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig } from '@agendex/shared';
import type { SyncPlanPayload, SyncPlanResult } from './api.ts';
import { runUpload } from './upload.ts';

let dir: string;
let prevConfigDir: string | undefined;
let prevSiteUrl: string | undefined;
let prevPwd: string | undefined;
let prevInitCwd: string | undefined;

interface Capture {
  readonly logs: string[];
  readonly errors: string[];
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
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agendex-upload-path-'));
  prevConfigDir = process.env.AGENDEX_CONFIG_DIR;
  prevSiteUrl = process.env.AGENDEX_SITE_URL;
  prevPwd = process.env.PWD;
  prevInitCwd = process.env.INIT_CWD;
  process.env.AGENDEX_CONFIG_DIR = join(dir, 'config');
  process.env.AGENDEX_SITE_URL = 'https://app.agendex.dev';
  delete process.env.INIT_CWD;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = prevConfigDir;
  if (prevSiteUrl === undefined) delete process.env.AGENDEX_SITE_URL;
  else process.env.AGENDEX_SITE_URL = prevSiteUrl;
  if (prevPwd === undefined) delete process.env.PWD;
  else process.env.PWD = prevPwd;
  if (prevInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = prevInitCwd;
  rmSync(dir, { recursive: true, force: true });
});

test('resolves relative upload paths from the launch directory when script cwd changes', async () => {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    convexUrl: 'https://example.convex.cloud',
  });
  process.env.PWD = dir;
  const file = join(dir, 'plan.md');
  writeFileSync(file, '# Root Script Plan\n\nbody');
  const cap: Capture = { logs: [], errors: [] };

  const code = await runUpload(['upload', './plan.md'], makeDeps({ ok: true }, cap));

  expect(code).toBe(0);
  expect(cap.lastPayload?.filePath).toBe(file);
  expect(cap.logs.join('\n')).toContain('uploaded "Root Script Plan"');
});
