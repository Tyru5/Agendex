import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import {
  getActiveAdapters,
  setActiveAdapters,
  getAll,
  getIndexableById,
  getIndexablePlans,
  loadConfig,
  saveConfig,
  scan,
  rescanFile,
  setOnPlansChanged,
  searchPlans,
} from '@agendex/shared';
import { plans } from './plans.ts';

let root: string;
let hiddenId: string;
let filePath: string;
let visibleId: string;
let authenticated: Hono;
let token: string;
const original = {
  home: process.env.AGENDEX_HOME,
  config: process.env.AGENDEX_CONFIG_DIR,
  adapters: getActiveAdapters(),
};
let notifications = 0;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agendex-hidden-route-'));
  process.env.AGENDEX_HOME = root;
  process.env.AGENDEX_CONFIG_DIR = join(root, 'config');
  const dir = join(root, 'plans');
  await mkdir(dir);
  filePath = join(dir, 'hidden.md');
  await writeFile(filePath, '# Hidden draft');
  await writeFile(
    join(dir, 'visible.md'),
    '# Visible plan\n## Steps\n1. Add handler.\n2. Run tests.',
  );
  saveConfig({ configVersion: 7, enabledAdapters: [], customPlanDirs: [dir] });
  setActiveAdapters([]);
  setOnPlansChanged(() => {
    notifications += 1;
  });
  await scan();
  hiddenId = getAll().find((plan) => plan.filePath === filePath)?.id ?? '';
  visibleId = getIndexablePlans()[0]?.id ?? '';
  expect(hiddenId).not.toBe('');
  expect(visibleId).not.toBe('');
  // Mount exactly the production auth middleware, not a test substitute.
  const auth = await import('../auth.ts');
  token = auth.AUTH_TOKEN;
  authenticated = new Hono();
  authenticated.use('/api/*', auth.authMiddleware);
  authenticated.route('/api/v1', plans);
});
afterAll(async () => {
  setActiveAdapters(original.adapters);
  setOnPlansChanged(() => {});
  if (original.home === undefined) delete process.env.AGENDEX_HOME;
  else process.env.AGENDEX_HOME = original.home;
  if (original.config === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = original.config;
  await rm(root, { recursive: true, force: true });
});
function call(path: string, init: RequestInit = {}) {
  return authenticated.request(`/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

test('hidden list/detail/recovery require auth and normal endpoints retain hiding', async () => {
  for (const path of [
    '/hidden-plans',
    `/hidden-plans/${hiddenId}`,
    `/hidden-plans/${hiddenId}/override`,
  ]) {
    expect(
      (
        await authenticated.request(`/api/v1${path}`, {
          method: path.endsWith('/override') ? 'PUT' : 'GET',
        })
      ).status,
    ).toBe(401);
  }
  const response = await call('/hidden-plans');
  const body = await response.json();
  expect(body.total).toBe(1);
  expect(body.hiddenCount).toBe(1);
  expect(body.plans[0].assessment.reasons).toEqual(['heading-only']);
  expect(body.plans[0].assessment.signals).toContain('negative:heading-only');
  expect(body.plans[0].content).toBeUndefined();
  const detail = await (await call(`/hidden-plans/${hiddenId}`)).json();
  expect(detail.plan.content).toBe('# Hidden draft');
  expect(detail.check.verificationDetected).toBe(false);
  for (const suffix of ['', '/raw', '/check', '/receipt', '/annotations']) {
    expect((await call(`/plans/${hiddenId}${suffix}`)).status).toBe(404);
  }
  expect(getIndexableById(hiddenId)).toBeUndefined();
  expect(searchPlans(getAll(), 'Hidden draft')).toEqual([]);
  expect((await call(`/hidden-plans/${visibleId}`)).status).toBe(404);
  expect((await call('/hidden-plans/stale')).status).toBe(404);
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=NaN',
    'offset=-1',
    'offset=9007199254740992',
  ]) {
    expect((await call(`/hidden-plans?${query}`)).status).toBe(400);
  }
  for (const body of [{ restore: 'true' }, {}, { restore: null }]) {
    expect(
      (
        await call(`/hidden-plans/${hiddenId}/override`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
  }
});

test('restore and undo persist across rescan without rewriting sources, and emit list updates', async () => {
  const before = notifications;
  const restored = await call(`/hidden-plans/${hiddenId}/override`, {
    method: 'PUT',
    body: JSON.stringify({ restore: true }),
  });
  expect(restored.status).toBe(200);
  expect((await restored.json()).hidden).toBe(false);
  expect(getIndexableById(hiddenId)?.metadata.planValueOverride).toBe('manual');
  expect(loadConfig()?.planValueOverrides?.[hiddenId]).toBe(true);
  expect(await readFile(filePath, 'utf8')).toBe('# Hidden draft');
  expect((await (await call('/hidden-plans')).json()).hiddenCount).toBe(0);
  expect(notifications).toBeGreaterThan(before);
  await rescanFile(filePath);
  await scan();
  expect(getIndexableById(hiddenId)?.content).toBe('# Hidden draft');
  expect((await (await call('/plans')).json()).total).toBe(2);
  const recovered = await (await call(`/hidden-plans/${hiddenId}`)).json();
  expect(recovered.plan.metadata.localPlanValueOverride).toBe(true);
  expect(recovered.assessment.reasons).toEqual(['heading-only']);
  expect(recovered.assessment.signals).not.toContain('metadata:manual-value-override');
  const reverted = await call(`/hidden-plans/${hiddenId}/override`, {
    method: 'PUT',
    body: JSON.stringify({ restore: false }),
  });
  expect((await reverted.json()).hidden).toBe(true);
  await scan();
  expect(getIndexableById(hiddenId)).toBeUndefined();
  expect(loadConfig()?.planValueOverrides?.[hiddenId]).toBeUndefined();
  expect((await (await call('/hidden-plans')).json()).hiddenCount).toBe(1);
  expect((await (await call('/plans')).json()).total).toBe(1);
  await rm(filePath);
  expect(
    (
      await call(`/hidden-plans/${hiddenId}/override`, {
        method: 'PUT',
        body: JSON.stringify({ restore: true }),
      })
    ).status,
  ).toBe(404);
  expect((await call(`/hidden-plans/${hiddenId}`)).status).toBe(404);
});

test('undo restore reclassifies improved content instead of forcing it hidden', async () => {
  await writeFile(filePath, '# Hidden draft');
  await scan();
  expect(
    (
      await call(`/hidden-plans/${hiddenId}/override`, {
        method: 'PUT',
        body: JSON.stringify({ restore: true }),
      })
    ).status,
  ).toBe(200);
  await writeFile(
    filePath,
    '# Improved draft\n## Steps\n1. Add a handler.\n2. Verify that responses return 200.',
  );
  await rescanFile(filePath);
  const undone = await call(`/hidden-plans/${hiddenId}/override`, {
    method: 'PUT',
    body: JSON.stringify({ restore: false }),
  });
  expect(undone.status).toBe(200);
  expect((await undone.json()).hidden).toBe(false);
  expect(getIndexableById(hiddenId)?.metadata.localPlanValueOverride).toBeUndefined();
  expect((await call(`/hidden-plans/${hiddenId}`)).status).toBe(404);
});
