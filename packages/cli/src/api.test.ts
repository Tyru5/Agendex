import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { saveConfig } from '@agendex/shared';
import {
  fetchPlannotatorWritebacks,
  type PlannotatorWritebackJob,
  reportPlannotatorWriteback,
} from './api.ts';

const originalEnv: Record<string, string | undefined> = {
  AGENDEX_CONFIG_DIR: process.env.AGENDEX_CONFIG_DIR,
  AGENDEX_DEV: process.env.AGENDEX_DEV,
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
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-cli-api-'));
  const parsedHome = parse(tempHome);
  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);
  return tempHome;
}

function startCloudApi(writebacks: PlannotatorWritebackJob[]) {
  const reports: Record<string, unknown>[] = [];
  server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (req.url?.startsWith('/api/cli/plannotator/writebacks') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ writebacks }));
      return;
    }

    if (req.url === '/api/cli/plannotator/writebacks/report' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        reports.push(JSON.parse(raw) as Record<string, unknown>);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise<{ url: string; reports: typeof reports }>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      resolve({ url: `http://127.0.0.1:${address.port}`, reports });
    });
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  restoreEnv('AGENDEX_CONFIG_DIR');
  restoreEnv('AGENDEX_DEV');
  restoreEnv('HOME');
  restoreEnv('USERPROFILE');
  restoreEnv('HOMEDRIVE');
  restoreEnv('HOMEPATH');
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

test('fetches and reports Plannotator write-back queue jobs', async () => {
  await useTempHome();
  const jobs: PlannotatorWritebackJob[] = [
    {
      _id: 'job-1',
      localPlanId: 'local-1',
      feedback: 'Please revise',
      source: 'agendex-cloud',
      expiresAt: Date.now() + 60_000,
      annotations: [
        {
          type: 'COMMENT',
          originalText: 'old',
          text: 'new guidance',
          source: 'test',
        },
      ],
    },
  ];
  const cloud = await startCloudApi(jobs);
  saveConfig({
    configVersion: 3,
    cloudToken: 'token',
    convexUrl: cloud.url,
    enabledAdapters: [],
    customPlanDirs: [],
  });

  const fetched = await fetchPlannotatorWritebacks();
  expect(fetched).toHaveLength(1);
  expect(fetched[0]?.annotations?.[0]?.type).toBe('COMMENT');

  const ok = await reportPlannotatorWriteback('job-1', 'sent');
  expect(ok).toBe(true);
  expect(cloud.reports).toEqual([{ writebackId: 'job-1', status: 'sent' }]);
});
