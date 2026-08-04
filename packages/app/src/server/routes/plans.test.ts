import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearPathResolveCache, getIndexablePlans, scan, setActiveAdapters } from '@agendex/shared';
import { junieAdapter } from '../../../../shared/src/adapters/file-artifact-adapters.ts';
import { plans } from './plans.ts';

let workspace: string;
let outside: string;
let planId: string;

const PLAN_CONTENT = `# Improve startup flow

## Context

The boot sequence in \`src/main.ts\` re-reads configuration on every request,
which slows the first paint. We will cache it during startup instead.

## Steps

1. Add a config cache to src/main.ts and invalidate it on file change.
2. Update \`packages/a/App.tsx\` to consume the cached value.
3. Verify the fallback path still works when the cache is cold.

## Verification

- [ ] Startup completes without re-reading configuration
- [ ] Existing tests continue to pass
`;

beforeAll(async () => {
  clearPathResolveCache();
  workspace = await mkdtemp(join(tmpdir(), 'agendex-plans-route-ws-'));
  outside = await mkdtemp(join(tmpdir(), 'agendex-plans-route-out-'));

  await mkdir(join(workspace, 'src'), { recursive: true });
  await mkdir(join(workspace, 'packages', 'a'), { recursive: true });
  await mkdir(join(workspace, 'packages', 'b'), { recursive: true });
  await mkdir(join(workspace, '.junie', 'plans'), { recursive: true });

  await writeFile(join(workspace, 'src', 'main.ts'), 'export {};');
  await writeFile(join(workspace, 'packages', 'a', 'App.tsx'), 'export {};');
  await writeFile(join(workspace, 'packages', 'b', 'App.tsx'), 'export {};');
  await writeFile(join(outside, 'secret.ts'), 'export {};');
  await writeFile(join(workspace, '.junie', 'plans', 'startup-flow.md'), PLAN_CONTENT);

  process.env.AGENDEX_JUNIE_PLAN_DIRS = join(workspace, '.junie', 'plans');
  setActiveAdapters([junieAdapter]);
  await scan();

  const plan = getIndexablePlans().find((p) => p.agent === 'junie');
  if (!plan) throw new Error('Expected the fixture plan to be indexed');
  if (!plan.workspace) throw new Error('Expected the fixture plan to carry a workspace');
  planId = plan.id;
});

afterAll(async () => {
  delete process.env.AGENDEX_JUNIE_PLAN_DIRS;
  await rm(workspace, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

async function postJson(path: string, body: unknown) {
  return plans.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /plans/:id/paths/exists', () => {
  test('reports found, ambiguous, and missing statuses', async () => {
    const res = await postJson(`/plans/${planId}/paths/exists`, {
      paths: ['src/main.ts', 'App.tsx', 'does/not/exist.ts', join(outside, 'secret.ts')],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Record<string, { status: string }> };
    expect(body.results['src/main.ts']?.status).toBe('found');
    expect(body.results['App.tsx']?.status).toBe('ambiguous');
    expect(body.results['does/not/exist.ts']?.status).toBe('missing');
    expect(body.results[join(outside, 'secret.ts')]?.status).toBe('missing');
  });

  test('rejects non-array payloads', async () => {
    const res = await postJson(`/plans/${planId}/paths/exists`, { paths: 'src/main.ts' });
    expect(res.status).toBe(400);
  });

  test('404s for unknown plans', async () => {
    const res = await postJson('/plans/nope/paths/exists', { paths: ['a.ts'] });
    expect(res.status).toBe(404);
  });
});

describe('GET /open-in/apps', () => {
  test('returns a host catalog that always includes reveal', async () => {
    const res = await plans.request('/open-in/apps');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; apps: Array<{ id: string }> };
    expect(body.available).toBe(true);
    expect(body.apps.some((app) => app.id === 'reveal')).toBe(true);
  });
});

describe('POST /plans/:id/open-in', () => {
  test('denies paths outside the workspace', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, {
      path: join(outside, 'secret.ts'),
      appId: 'reveal',
    });
    expect(res.status).toBe(404);
  });

  test('denies traversal escapes', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, {
      path: '../../etc/hosts',
      appId: 'reveal',
    });
    expect(res.status).toBe(404);
  });

  test('reports ambiguous paths instead of guessing', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, { path: 'App.tsx', appId: 'reveal' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { matches: string[] };
    expect(body.matches).toHaveLength(2);
  });

  test('fails cleanly for unavailable applications', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, {
      path: 'src/main.ts',
      appId: 'no-such-app',
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  test('requires a path', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, { appId: 'reveal' });
    expect(res.status).toBe(400);
  });
});
