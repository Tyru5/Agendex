import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { saveConfig } from '@agendex/shared';
import {
  fetchCloudPlan,
  listCloudPlans,
  fetchPlannotatorWritebacks,
  getDaemonCloudScope,
  resetDaemonCredentialStore,
  type PlannotatorWritebackJob,
  reportPlannotatorWriteback,
  sendHeartbeat,
  setDaemonCredentialStore,
  syncPlan,
} from './api.ts';
import { setInjectedWorkspaceKey } from './cloud-crypto.ts';

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

interface CloudApiOptions {
  heartbeatStatus?: number;
  refreshStatus?: number;
  syncStatus?: number;
  planStatus?: number;
  planBody?: Record<string, unknown>;
  plansStatus?: number;
  plansBody?: Record<string, unknown>;
  cryptoBody?: Record<string, unknown>;
}

function startCloudApi(writebacks: PlannotatorWritebackJob[], options: CloudApiOptions = {}) {
  const reports: Record<string, unknown>[] = [];
  const heartbeats: Record<string, unknown>[] = [];
  const requests: string[] = [];
  server = createServer((req, res) => {
    requests.push(`${req.method ?? 'GET'} ${req.url ?? '/'}`);
    if (
      req.headers.authorization !== 'Bearer token' &&
      req.headers.authorization !== 'Bearer refreshed-token'
    ) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (req.url === '/api/cli/refresh' && req.method === 'POST') {
      const status = options.refreshStatus ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          status === 200
            ? {
                token: 'refreshed-token',
                accountId: 'account-1',
                expiresAt: Date.now() + 60_000,
              }
            : { error: 'Unauthorized' },
        ),
      );
      return;
    }

    if (req.url === '/api/cli/crypto' && req.method === 'GET') {
      if (!options.cryptoBody) {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(options.cryptoBody));
      }
      return;
    }

    if (
      (req.url === '/api/cli/plans' || req.url?.startsWith('/api/cli/plans?')) &&
      req.method === 'GET'
    ) {
      const status = options.plansStatus ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          options.plansBody ?? {
            status: 'ok',
            plans: [
              {
                id: 'plan-1',
                agent: 'claude-code',
                title: 'Add auth',
                updatedAt: '2026-08-02T00:00:00.000Z',
              },
            ],
            continueCursor: null,
            isDone: true,
          },
        ),
      );
      return;
    }

    if (
      (req.url === '/api/cli/plan' || req.url?.startsWith('/api/cli/plan?')) &&
      req.method === 'GET'
    ) {
      const status = options.planStatus ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          options.planBody ?? {
            status: 'found',
            plan: {
              id: 'plan-1',
              agent: 'claude-code',
              title: 'Add auth',
              content: '# Add auth\n',
              format: 'markdown',
              filePath: '/tmp/add-auth.md',
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-02T00:00:00.000Z',
            },
          },
        ),
      );
      return;
    }

    if (req.url === '/api/cli/sync' && req.method === 'POST') {
      const status = options.syncStatus ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { ok: true } : { error: 'Forbidden' }));
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

    if (req.url === '/api/cli/heartbeat' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        heartbeats.push(JSON.parse(raw) as Record<string, unknown>);
        const status = options.heartbeatStatus ?? 200;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status === 200 ? { ok: true } : { error: 'Unauthorized' }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise<{
    url: string;
    reports: typeof reports;
    heartbeats: typeof heartbeats;
    requests: typeof requests;
  }>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        reports,
        heartbeats,
        requests,
      });
    });
  });
}

function saveCloudConfig(convexUrl: string) {
  saveConfig({
    configVersion: 3,
    cloudToken: 'token',
    cloudAccountId: 'account-1',
    convexUrl,
    enabledAdapters: [],
    customPlanDirs: [],
  });
}

test('keeps the cloud cache scope stable across token rotation', () => {
  let credentials = {
    token: 'token-a',
    convexUrl: 'https://example.convex.site',
    accountId: 'account-1',
  };
  setDaemonCredentialStore({
    load: () => credentials,
    saveToken: () => true,
  });

  const scope = getDaemonCloudScope();
  credentials = { ...credentials, token: 'token-b' };
  expect(getDaemonCloudScope()).toBe(scope);

  credentials = { ...credentials, accountId: 'account-2' };
  expect(getDaemonCloudScope()).not.toBe(scope);
});

test('sends local IP address in heartbeat payload', async () => {
  await useTempHome();
  const cloud = await startCloudApi([]);
  saveCloudConfig(cloud.url);

  await sendHeartbeat('192.168.4.30');

  expect(cloud.heartbeats).toHaveLength(1);
  expect(cloud.heartbeats[0]).toMatchObject({ ipAddress: '192.168.4.30' });
});

test('reports whether an encrypted desktop daemon has an injected key', async () => {
  await useTempHome();
  const cloud = await startCloudApi([], {
    cryptoBody: {
      enabled: true,
      role: 'owner',
      workspaceOwnerId: 'owner-1',
      state: 'sealed',
      activeKeyEpoch: 1,
      minimumClientProtocol: 1,
      ownerKdf: {},
      ownerPassphraseWrappedKey: {},
    },
  });
  saveCloudConfig(cloud.url);
  setInjectedWorkspaceKey('owner-1', 1, Buffer.alloc(32, 7).toString('base64'));
  try {
    await sendHeartbeat('192.168.4.30');
  } finally {
    setInjectedWorkspaceKey('owner-1', 1, null);
  }

  expect(cloud.heartbeats).toHaveLength(1);
  expect(cloud.heartbeats[0]).toMatchObject({ cryptoUnlocked: true });
  expect(cloud.heartbeats[0]?.hostname).toBeUndefined();
  expect(cloud.heartbeats[0]?.ipAddress).toBeUndefined();
  expect(cloud.heartbeats[0]?.encryptedHostname).toBeDefined();
});

test('fetches and reports Plannotator write-back queue jobs', async () => {
  await useTempHome();
  const jobs: PlannotatorWritebackJob[] = [
    {
      _id: 'job-1',
      localPlanId: 'local-1',
      action: 'approve',
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
  saveCloudConfig(cloud.url);

  const fetched = await fetchPlannotatorWritebacks();
  expect(fetched).toHaveLength(1);
  expect(fetched[0]?.action).toBe('approve');
  expect(fetched[0]?.annotations?.[0]?.type).toBe('COMMENT');

  const ok = await reportPlannotatorWriteback('job-1', 'sent');
  expect(ok).toBe(true);
  expect(cloud.reports).toEqual([{ writebackId: 'job-1', status: 'sent' }]);
});

test('uses an injected in-memory credential store for desktop workers', async () => {
  await useTempHome();
  const cloud = await startCloudApi([]);
  setDaemonCredentialStore({
    load: () => ({ token: 'token', convexUrl: cloud.url }),
    saveToken: () => true,
  });

  await sendHeartbeat();

  expect(cloud.heartbeats).toHaveLength(1);
});

test('does not treat a Cloud Pro entitlement response as expired authentication', async () => {
  await useTempHome();
  const cloud = await startCloudApi([], { syncStatus: 403 });
  let authExpiredCount = 0;
  setDaemonCredentialStore({
    load: () => ({ token: 'token', convexUrl: cloud.url }),
    saveToken: () => true,
    onAuthExpired: () => {
      authExpiredCount += 1;
    },
  });

  const result = await syncPlan({
    localPlanId: 'plan-1',
    agent: 'codex',
    title: 'Free plan',
    content: '# Plan',
    format: 'markdown',
  });

  expect(result.status).toBe(403);
  expect(authExpiredCount).toBe(0);
  expect(cloud.requests.some((request) => request.endsWith('/api/cli/refresh'))).toBe(false);
});

test('reports authentication expiry when heartbeat token refresh fails', async () => {
  await useTempHome();
  const cloud = await startCloudApi([], { heartbeatStatus: 401, refreshStatus: 401 });
  const expiredTokens: string[] = [];
  setDaemonCredentialStore({
    load: () => ({ token: 'token', convexUrl: cloud.url }),
    saveToken: () => true,
    onAuthExpired: (failedToken) => expiredTokens.push(failedToken),
  });

  await sendHeartbeat();

  expect(expiredTokens).toEqual(['token']);
  expect(cloud.requests.some((request) => request.endsWith('/api/cli/refresh'))).toBe(true);
});

test('does not expire authentication when token refresh is transiently unavailable', async () => {
  await useTempHome();
  const cloud = await startCloudApi([], { heartbeatStatus: 401, refreshStatus: 500 });
  const expiredTokens: string[] = [];
  setDaemonCredentialStore({
    load: () => ({ token: 'token', convexUrl: cloud.url }),
    saveToken: () => true,
    onAuthExpired: (failedToken) => expiredTokens.push(failedToken),
  });

  await sendHeartbeat();

  expect(expiredTokens).toEqual([]);
});

test('does not retry an old account when refreshed credentials fail compare-and-swap', async () => {
  await useTempHome();
  const cloud = await startCloudApi([], { syncStatus: 401 });
  let current = { token: 'token', convexUrl: cloud.url };
  setDaemonCredentialStore({
    load: () => current,
    saveToken: () => {
      current = { token: 'new-account-token', convexUrl: 'https://new.convex.site' };
      return false;
    },
  });

  const result = await syncPlan({
    localPlanId: 'plan-1',
    agent: 'codex',
    title: 'Account switch',
    content: '# Plan',
    format: 'markdown',
  });

  expect(result.status).toBe(503);
  expect(cloud.requests.filter((request) => request === 'POST /api/cli/sync')).toHaveLength(1);
});

test('fetchCloudPlan returns a found plan and sends query params', async () => {
  await useTempHome();
  const cloud = await startCloudApi([]);
  saveCloudConfig(cloud.url);

  const result = await fetchCloudPlan('Add auth', 'claude-code');
  expect(result).toEqual({
    kind: 'found',
    plan: {
      id: 'plan-1',
      agent: 'claude-code',
      title: 'Add auth',
      content: '# Add auth\n',
      format: 'markdown',
      filePath: '/tmp/add-auth.md',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    },
  });
  expect(
    cloud.requests.some((request) =>
      request.includes('GET /api/cli/plan?q=Add+auth&agent=claude-code'),
    ),
  ).toBe(true);
});

test('fetchCloudPlan maps 409 to ambiguous and 404 to not_found', async () => {
  await useTempHome();
  const ambiguous = await startCloudApi([], {
    planStatus: 409,
    planBody: {
      status: 'ambiguous',
      matches: [
        {
          id: 'p1',
          agent: 'claude-code',
          title: 'Add auth',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
      ],
    },
  });
  saveCloudConfig(ambiguous.url);
  expect(await fetchCloudPlan('Add auth')).toEqual({
    kind: 'ambiguous',
    matches: [
      { id: 'p1', agent: 'claude-code', title: 'Add auth', updatedAt: '2026-08-02T00:00:00.000Z' },
    ],
  });

  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }

  const missing = await startCloudApi([], {
    planStatus: 404,
    planBody: {
      status: 'not_found',
      suggestions: [
        {
          id: 'p2',
          agent: 'claude-code',
          title: 'Add auth',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
      ],
    },
  });
  saveCloudConfig(missing.url);
  expect(await fetchCloudPlan('Add autth')).toEqual({
    kind: 'not_found',
    suggestions: [
      {
        id: 'p2',
        agent: 'claude-code',
        title: 'Add auth',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ],
  });
});

test('fetchCloudPlan treats a 409 without ambiguous status as a server error', async () => {
  await useTempHome();
  const truncated = await startCloudApi([], {
    planStatus: 409,
    planBody: { error: 'Title lookup did not finish scanning all plans. Retry with a plan id.' },
  });
  saveCloudConfig(truncated.url);

  expect(await fetchCloudPlan('Add auth')).toEqual({
    kind: 'error',
    status: 409,
    message: 'Title lookup did not finish scanning all plans. Retry with a plan id.',
  });
});

test('listCloudPlans returns recent plans and sends query params', async () => {
  await useTempHome();
  const cloud = await startCloudApi([]);
  saveCloudConfig(cloud.url);

  const result = await listCloudPlans({ query: 'Add auth', agent: 'claude-code' });
  expect(result).toEqual({
    kind: 'ok',
    plans: [
      {
        id: 'plan-1',
        agent: 'claude-code',
        title: 'Add auth',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ],
    continueCursor: null,
    isDone: true,
  });
  expect(
    cloud.requests.some((request) =>
      request.includes('GET /api/cli/plans?q=Add+auth&agent=claude-code'),
    ),
  ).toBe(true);
});

test('listCloudPlans treats a generic 404 as a missing browse route', async () => {
  await useTempHome();
  const missingRoute = await startCloudApi([], { plansStatus: 404, plansBody: {} });
  saveCloudConfig(missingRoute.url);

  expect(await listCloudPlans()).toEqual({
    kind: 'error',
    status: 404,
    message:
      'Cloud browse is not available on this server. Update the Agendex cloud deployment or check that you are logged into the right host.',
  });
});

test('fetchCloudPlan treats a generic 404 as a server error, not a missing plan', async () => {
  await useTempHome();
  const missingRoute = await startCloudApi([], { planStatus: 404, planBody: {} });
  saveCloudConfig(missingRoute.url);

  expect(await fetchCloudPlan('Add auth')).toEqual({
    kind: 'error',
    status: 404,
    message:
      'Cloud download is not available on this server. Update the Agendex cloud deployment or check that you are logged into the right host.',
  });
});

afterEach(async () => {
  resetDaemonCredentialStore();
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
