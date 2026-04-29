import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { getAll, requestChanges, scan } from '../services/plan-service.ts';
import type { PlannotatorFeedbackAnnotation } from '../types.ts';
import { isSafePlannotatorUrl, plannotatorAdapter } from './plannotator.ts';
import { getActiveAdapters, setActiveAdapters } from './registry.ts';

const originalAdapters = getActiveAdapters();
const originalCwd = process.cwd();
const originalEnv: Record<string, string | undefined> = {
  AGENDEX_CONFIG_DIR: process.env.AGENDEX_CONFIG_DIR,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
  AGENDEX_PLANNOTATOR_DIR: process.env.AGENDEX_PLANNOTATOR_DIR,
};

let tempHome: string | undefined;
let server: Server | undefined;

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function useTempHome() {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plannotator-'));
  const parsedHome = parse(tempHome);
  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex');
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);
  process.env.AGENDEX_PLANNOTATOR_DIR = join(tempHome, '.plannotator');
  return tempHome;
}

function startPlannotatorTestServer(
  plan = '# Live Plan\n\nBody',
  mode: 'plan' | 'review' | 'annotate' = 'plan',
) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  server = createServer((req, res) => {
    if (req.url === '/api/plan' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ plan, origin: 'claude-code', mode, projectRoot: '/repo' }));
      return;
    }

    if ((req.url === '/api/deny' || req.url === '/api/feedback') && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        requests.push({ path: req.url ?? '', body: JSON.parse(raw) as Record<string, unknown> });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise<{ url: string; requests: typeof requests }>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      resolve({ url: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

afterEach(async () => {
  setActiveAdapters(originalAdapters);
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  process.chdir(originalCwd);
  setActiveAdapters([]);
  await scan();
  restoreEnv('AGENDEX_CONFIG_DIR');
  restoreEnv('HOME');
  restoreEnv('USERPROFILE');
  restoreEnv('HOMEDRIVE');
  restoreEnv('HOMEPATH');
  restoreEnv('AGENDEX_PLANNOTATOR_DIR');
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
  setActiveAdapters(originalAdapters);
});

test('parses saved Plannotator snapshots with companion annotation metadata', async () => {
  const home = await useTempHome();
  const plansDir = join(home, '.plannotator', 'plans');
  await mkdir(plansDir, { recursive: true });
  const snapshot = join(plansDir, 'auth-flow-2026-01-02-denied.md');
  const annotations = join(plansDir, 'auth-flow-2026-01-02.annotations.md');
  await writeFile(snapshot, '# Auth Flow\n\nPlan body', 'utf-8');
  await writeFile(annotations, '# Feedback\n\nNeeds tests', 'utf-8');

  setActiveAdapters([plannotatorAdapter]);
  await scan();

  const [plan] = getAll();
  expect(plan?.agent).toBe('plannotator');
  expect(plan?.title).toBe('Auth Flow');
  expect(plan?.metadata.sourceAdapter).toBe('plannotator');
  expect((plan?.metadata.plannotator as { status?: string }).status).toBe('denied');
  expect((plan?.metadata.plannotator as { annotationsPath?: string }).annotationsPath).toBe(
    annotations,
  );
});

test('parses project-level Plannotator @plans directories', async () => {
  const tempRoot = await useTempHome();
  const home = join(tempRoot, 'home');
  await mkdir(home, { recursive: true });
  const parsedHome = parse(home);
  process.env.AGENDEX_CONFIG_DIR = join(home, '.agendex');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = home.slice(parsedHome.root.length - 1);
  process.env.AGENDEX_PLANNOTATOR_DIR = join(home, '.plannotator');

  const projectRoot = join(tempRoot, 'workspace', 'demo-project');
  const projectPlansDir = join(projectRoot, '@plans');
  await mkdir(projectPlansDir, { recursive: true });
  const planPath = join(projectPlansDir, 'checkout-refactor.md');
  const annotationsPath = join(projectPlansDir, 'checkout-refactor.annotations.md');
  await writeFile(planPath, '# Checkout Refactor\n\nProject-local plan body', 'utf-8');
  await writeFile(annotationsPath, '## Comment\n\nKeep this indexed with the plan.', 'utf-8');
  process.chdir(projectRoot);

  setActiveAdapters([plannotatorAdapter]);
  await scan();

  const [plan] = getAll();
  expect(plan?.agent).toBe('plannotator');
  expect(plan?.title).toBe('Checkout Refactor');
  expect(plan?.filePath.endsWith('/@plans/checkout-refactor.md')).toBe(true);
  expect(plan?.workspace?.endsWith('/workspace/demo-project')).toBe(true);
  expect(plan?.metadata.sourceAdapter).toBe('plannotator');
  expect((plan?.metadata.plannotator as { kind?: string }).kind).toBe('project-plan');
  expect(
    (plan?.metadata.plannotator as { annotationsPath?: string }).annotationsPath?.endsWith(
      '/@plans/checkout-refactor.annotations.md',
    ),
  ).toBe(true);
  expect((plan?.metadata.plannotator as { writebackCapable?: boolean }).writebackCapable).toBe(
    false,
  );
});

test('parses live Plannotator sessions from loopback servers', async () => {
  const home = await useTempHome();
  const { url } = await startPlannotatorTestServer();
  const sessionsDir = join(home, '.plannotator', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, `${process.pid}.json`),
    JSON.stringify({
      pid: process.pid,
      port: Number(new URL(url).port),
      url,
      mode: 'plan',
      project: 'repo',
    }),
    'utf-8',
  );

  setActiveAdapters([plannotatorAdapter]);
  await scan();

  const [plan] = getAll();
  expect(plan?.agent).toBe('claude-code');
  expect(plan?.content).toContain('Live Plan');
  expect((plan?.metadata.plannotator as { kind?: string }).kind).toBe('live-session');
  expect((plan?.metadata.plannotator as { writebackCapable?: boolean }).writebackCapable).toBe(
    true,
  );
});

test('skips stale Plannotator live sessions', async () => {
  const home = await useTempHome();
  const sessionsDir = join(home, '.plannotator', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'stale.json'),
    JSON.stringify({ pid: 999_999_999, url: 'http://127.0.0.1:9', mode: 'plan' }),
    'utf-8',
  );

  setActiveAdapters([plannotatorAdapter]);
  await scan();

  expect(getAll()).toHaveLength(0);
});

test('requestChanges routes Plannotator plans to /api/deny with typed annotations', async () => {
  const home = await useTempHome();
  const { url, requests } = await startPlannotatorTestServer();
  const sessionsDir = join(home, '.plannotator', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, url, mode: 'plan' }),
    'utf-8',
  );

  const annotation: PlannotatorFeedbackAnnotation = {
    type: 'COMMENT',
    originalText: 'Body',
    text: 'Add detail here',
    source: 'agendex-test',
  };

  setActiveAdapters([plannotatorAdapter]);
  await scan();
  const [plan] = getAll();
  if (!plan) throw new Error('Expected a parsed Plannotator plan');

  const ok = await requestChanges(plan.id, {
    feedback: 'Please revise this plan.',
    revisedContent: '# Revised Plan',
    annotations: [annotation],
    source: 'agendex-cloud',
  });

  expect(ok).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.path).toBe('/api/deny');
  expect(String(requests[0]?.body.feedback)).toContain('Agendex Plan Feedback');
});

test('requestChanges routes Plannotator review sessions to /api/feedback', async () => {
  const home = await useTempHome();
  const { url, requests } = await startPlannotatorTestServer('# Review\n\nBody', 'review');
  const sessionsDir = join(home, '.plannotator', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, url, mode: 'review' }),
    'utf-8',
  );

  const annotation: PlannotatorFeedbackAnnotation = {
    type: 'comment',
    scope: 'line',
    filePath: 'src/index.ts',
    lineStart: 4,
    lineEnd: 6,
    text: 'Tighten this implementation.',
  };

  setActiveAdapters([plannotatorAdapter]);
  await scan();
  const [plan] = getAll();
  if (!plan) throw new Error('Expected a parsed Plannotator review plan');

  const ok = await requestChanges(plan.id, {
    feedback: 'Please address the review comments.',
    annotations: [annotation],
    source: 'agendex-cloud',
  });

  expect(ok).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.path).toBe('/api/feedback');
  expect(requests[0]?.body.annotations).toEqual([annotation]);
});

test('validates Plannotator live URLs to avoid SSRF', () => {
  expect(isSafePlannotatorUrl('http://127.0.0.1:19432')).toBe(true);
  expect(isSafePlannotatorUrl('http://localhost:19432')).toBe(true);
  expect(isSafePlannotatorUrl('https://localhost:19432')).toBe(false);
  expect(isSafePlannotatorUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  expect(isSafePlannotatorUrl('http://example.com')).toBe(false);
  expect(isSafePlannotatorUrl('http://127.0.0.1:19432/path')).toBe(false);
});
