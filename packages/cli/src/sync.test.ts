import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { CURRENT_CONFIG_VERSION, saveConfig } from '@agendex/shared';
import type { SyncPlanPayload } from './api.ts';
import { syncAll } from './sync.ts';

const originalEnv: Record<string, string | undefined> = {
  AGENDEX_CONFIG_DIR: process.env.AGENDEX_CONFIG_DIR,
  AGENDEX_DEV: process.env.AGENDEX_DEV,
  AGENDEX_DISABLE_LOCAL_IP: process.env.AGENDEX_DISABLE_LOCAL_IP,
  AGENDEX_PLANNOTATOR_SYNC: process.env.AGENDEX_PLANNOTATOR_SYNC,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

let tempHome: string | undefined;
let server: Server | undefined;

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function useTempHome() {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-cli-sync-'));
  const parsedHome = parse(tempHome);
  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.AGENDEX_DISABLE_LOCAL_IP = '1';
  process.env.AGENDEX_PLANNOTATOR_SYNC = '0';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);
  return tempHome;
}

function startSyncApi() {
  const requests: SyncPlanPayload[] = [];
  server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (req.url === '/api/cli/sync' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        let payload: SyncPlanPayload;
        try {
          payload = JSON.parse(raw) as SyncPlanPayload;
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        requests.push(payload);
        const lowValue = payload.metadata?.lowValue === true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, skippedLowValue: lowValue, deleted: lowValue }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise<{ url: string; requests: SyncPlanPayload[] }>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      resolve({ url: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

test('syncAll sends low-value local plans only as prune payloads and caches them', async () => {
  const home = await useTempHome();
  const customDir = join(home, 'custom-plans');
  await mkdir(customDir, { recursive: true });
  await writeFile(
    join(customDir, 'real-plan.md'),
    '# Plan\n\n## Approach\nAdd validation.\n\n## Steps\n- [ ] Implement helper\n- [ ] Add tests\n',
    'utf-8',
  );
  await writeFile(join(customDir, 'code-only.md'), '```ts\nexport const x = 1;\n```', 'utf-8');

  const cloud = await startSyncApi();
  saveConfig({
    configVersion: CURRENT_CONFIG_VERSION,
    cloudToken: 'token',
    convexUrl: cloud.url,
    enabledAdapters: ['antigravity'],
    customPlanDirs: [customDir],
  });

  await syncAll();

  expect(cloud.requests).toHaveLength(2);
  const normalPayload = cloud.requests.find((payload) => payload.title === 'Plan');
  const prunePayload = cloud.requests.find((payload) => payload.title === 'code-only');

  expect(normalPayload?.metadata?.lowValue).toBeUndefined();
  expect(normalPayload?.syncIdentityKey).toContain(':custom-dir:path:real-plan.md');
  expect(normalPayload?.contentHash).toBeDefined();
  expect(normalPayload?.identityStrength).toBe('path');
  expect(prunePayload?.metadata?.lowValue).toBe(true);
  expect(prunePayload?.metadata?.lowValueReasons).toContain('code-only');
  expect(prunePayload?.syncIdentityKey).toContain(':custom-dir:path:code-only.md');
  expect(prunePayload?.contentHash).toBeDefined();

  await syncAll();
  expect(cloud.requests).toHaveLength(2);

  await syncAll(true);
  expect(cloud.requests).toHaveLength(4);
  expect(cloud.requests.filter((payload) => payload.metadata?.lowValue === true)).toHaveLength(2);
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  restoreEnv('AGENDEX_CONFIG_DIR');
  restoreEnv('AGENDEX_DEV');
  restoreEnv('AGENDEX_DISABLE_LOCAL_IP');
  restoreEnv('AGENDEX_PLANNOTATOR_SYNC');
  restoreEnv('HOME');
  restoreEnv('USERPROFILE');
  restoreEnv('HOMEDRIVE');
  restoreEnv('HOMEPATH');
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});
