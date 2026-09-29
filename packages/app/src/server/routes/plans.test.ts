import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearPathResolveCache,
  clearPlanReceiptCache,
  getIndexablePlans,
  scan,
  setActiveAdapters,
} from '@agendex/shared';
import type { PlanReceipt, PlanReceiptSummary } from '@agendex/shared/receipts';
import { junieAdapter } from '../../../../shared/src/adapters/file-artifact-adapters.ts';
import { plans } from './plans.ts';

let workspace: string;
let outside: string;
let planId: string;
let planFilePath: string;
let ledgerPlanId: string;
let ledgerPlanCreatedAt: Date;

// The only plan that mentions src/ledger.ts, so no other fixture plan supersedes it.
const LEDGER_PLAN_CONTENT = `# Record ledger totals

## Steps

1. Sum the entries in \`src/ledger.ts\` before writing them.
`;

function git(args: string[], env?: Record<string, string>) {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Agendex Test',
      '-c',
      'user.email=test@agendex.dev',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: workspace, env: { ...process.env, ...env }, stdio: 'ignore' },
  );
}

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

// Only mention of "rate limiting" sits deep in the body, past the first 650 characters.
const DEEP_RATE_LIMIT_CONTENT = `# Harden the public gateway

## Context

${'The gateway forwards every request to the upstream service without any guard. '.repeat(9)}

## Steps

1. Add rate limiting to the gateway middleware in src/main.ts.
2. Return a clear error when a client exceeds its budget.

## Verification

- [ ] Burst traffic is rejected with a clear error
`;

const TITLE_RATE_LIMIT_CONTENT = `# Rate limiting for uploads

## Context

Uploads can flood the worker queue.

## Steps

1. Cap concurrent uploads per user in src/main.ts.
2. Queue the overflow instead of dropping it.

## Verification

- [ ] Excess uploads wait in the queue
`;

beforeAll(async () => {
  clearPathResolveCache();
  workspace = await mkdtemp(join(tmpdir(), 'agendex-plans-route-ws-'));
  outside = await mkdtemp(join(tmpdir(), 'agendex-plans-route-out-'));

  await mkdir(join(workspace, 'src'), { recursive: true });
  await mkdir(join(workspace, 'packages', 'a'), { recursive: true });
  await mkdir(join(workspace, 'packages', 'b'), { recursive: true });
  await mkdir(join(workspace, '.junie', 'plans'), { recursive: true });
  // Written first so the receipt tests rarely need to wait for its birthtime's next second.
  await writeFile(join(workspace, '.junie', 'plans', 'ledger-totals.md'), LEDGER_PLAN_CONTENT);

  await writeFile(join(workspace, 'src', 'main.ts'), 'export {};');
  await writeFile(join(workspace, 'packages', 'a', 'App.tsx'), 'export {};');
  await writeFile(join(workspace, 'packages', 'b', 'App.tsx'), 'export {};');
  await writeFile(join(workspace, 'src', 'ledger.ts'), 'export const total = 0;\n');
  await writeFile(join(outside, 'secret.ts'), 'export {};');
  // The workspace is a git repo whose history predates every fixture plan.
  git(['init', '-q', '-b', 'main']);
  git(['add', 'src', 'packages']);
  git(['commit', '-q', '--no-verify', '-m', 'Initial commit'], {
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  });
  await writeFile(join(workspace, '.junie', 'plans', 'startup-flow.md'), PLAN_CONTENT);
  const deepPath = join(workspace, '.junie', 'plans', 'gateway-hardening.md');
  const titlePath = join(workspace, '.junie', 'plans', 'upload-limits.md');
  await writeFile(deepPath, DEEP_RATE_LIMIT_CONTENT);
  await writeFile(titlePath, TITLE_RATE_LIMIT_CONTENT);
  // The deep-content plan is the most recent, so relevance must beat recency.
  await utimes(titlePath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
  await utimes(deepPath, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'));

  process.env.AGENDEX_JUNIE_PLAN_DIRS = join(workspace, '.junie', 'plans');
  setActiveAdapters([junieAdapter]);
  await scan();

  const plan = getIndexablePlans().find((p) => p.filePath.endsWith('startup-flow.md'));
  if (!plan) throw new Error('Expected the fixture plan to be indexed');
  if (!plan.workspace) throw new Error('Expected the fixture plan to carry a workspace');
  planId = plan.id;
  planFilePath = plan.filePath;

  const ledgerPlan = getIndexablePlans().find((p) => p.filePath.endsWith('ledger-totals.md'));
  if (!ledgerPlan) throw new Error('Expected the ledger plan to be indexed');
  ledgerPlanId = ledgerPlan.id;
  ledgerPlanCreatedAt = ledgerPlan.createdAt;
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

describe('GET /plans?q=', () => {
  async function searchTitles(query: string) {
    const res = await plans.request(`/plans?${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plans: Array<{ title: string }>; total: number };
    return { titles: body.plans.map((p) => p.title), total: body.total };
  }

  // User story: a search finds text deep in a plan and ranks the best match first.
  test('returns matches in relevance order, including deep content hits', async () => {
    expect(DEEP_RATE_LIMIT_CONTENT.indexOf('rate limiting')).toBeGreaterThan(650);
    const { titles, total } = await searchTitles('q=rate%20limiting');
    expect(titles).toEqual(['Rate limiting for uploads', 'Harden the public gateway']);
    expect(total).toBe(2);
  });

  // User story: an explicit sort still wins over relevance.
  test('re-sorts search results when sort is given', async () => {
    const { titles } = await searchTitles('q=rate%20limiting&sort=updatedAt');
    expect(titles).toEqual(['Harden the public gateway', 'Rate limiting for uploads']);
  });
});

describe('POST /plans/:id/paths/exists', () => {
  // User story: a local plan can validate exact, ambiguous, missing, and unsafe paths.
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

  // User story: malformed browser requests fail without touching the filesystem.
  test('rejects non-array payloads', async () => {
    const res = await postJson(`/plans/${planId}/paths/exists`, { paths: 'src/main.ts' });
    expect(res.status).toBe(400);
  });

  // User story: an unknown plan cannot nominate a local workspace by id alone.
  test('404s for unknown plans', async () => {
    const res = await postJson('/plans/nope/paths/exists', { paths: ['a.ts'] });
    expect(res.status).toBe(404);
  });

  // User story: a cloud Convex id resolves to its already-indexed local source plan.
  test('bridges a cloud plan id through its indexed source file', async () => {
    const res = await postJson('/plans/cloud-plan-id/paths/exists', {
      paths: ['src/main.ts'],
      sourceFilePath: planFilePath,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Record<string, { status: string }> };
    expect(body.results['src/main.ts']?.status).toBe('found');
  });

  // User story: a cloud plan cannot use an arbitrary file as a local workspace identity.
  test('rejects source files that are not in the local plan index', async () => {
    const res = await postJson('/plans/cloud-plan-id/paths/exists', {
      paths: ['secret.ts'],
      sourceFilePath: join(outside, 'secret.ts'),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /open-in/apps', () => {
  // User story: the open-with menu always offers the host file manager.
  test('returns a host catalog that always includes reveal', async () => {
    const res = await plans.request('/open-in/apps');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; apps: Array<{ id: string }> };
    expect(body.available).toBe(true);
    expect(body.apps.some((app) => app.id === 'reveal')).toBe(true);
  });
});

describe('POST /plans/:id/open-in', () => {
  // User story: source actions cannot open files outside the plan workspace.
  test('denies paths outside the workspace', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, {
      path: join(outside, 'secret.ts'),
      appId: 'reveal',
    });
    expect(res.status).toBe(404);
  });

  // User story: traversal syntax cannot escape the plan workspace.
  test('denies traversal escapes', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, {
      path: '../../etc/hosts',
      appId: 'reveal',
    });
    expect(res.status).toBe(404);
  });

  // User story: duplicate basenames prompt for a specific match instead of guessing.
  test('reports ambiguous paths instead of guessing', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, { path: 'App.tsx', appId: 'reveal' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { matches: string[] };
    expect(body.matches).toHaveLength(2);
  });

  // User story: unavailable editors return a useful failure without crashing the server.
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

  // User story: an open request must identify the source path to act on.
  test('requires a path', async () => {
    const res = await postJson(`/plans/${planId}/open-in`, { appId: 'reveal' });
    expect(res.status).toBe(400);
  });

  // User story: opening from a cloud plan uses the matching indexed local source safely.
  test('bridges a cloud plan id before opening a source file', async () => {
    const res = await postJson('/plans/cloud-plan-id/open-in', {
      path: 'src/main.ts',
      appId: 'no-such-app',
      sourceFilePath: planFilePath,
    });
    expect(res.status).toBe(502);
  });
});

describe('plan receipts', () => {
  beforeAll(async () => {
    // The plan's createdAt is the fixture file's real birthtime and git timestamps are whole
    // seconds, so the commit lands on the next second boundary. An open receipt window never
    // counts future commits, and fake timers cannot move file birthtimes or the git subprocess
    // clock, so wait for the platform clock to reach that second when it hasn't already.
    const committedAtSec = Math.ceil(ledgerPlanCreatedAt.getTime() / 1000);
    const waitMs = committedAtSec * 1000 - Date.now();
    if (waitMs > 0) await Bun.sleep(waitMs + 20);
    await writeFile(join(workspace, 'src', 'ledger.ts'), 'export const total = 42;\n');
    git(['commit', '-q', '--no-verify', '-am', 'Sum ledger totals'], {
      GIT_AUTHOR_DATE: `@${committedAtSec} +0000`,
      GIT_COMMITTER_DATE: `@${committedAtSec} +0000`,
    });
    clearPlanReceiptCache();
  });

  // User story: an unknown or hidden plan id never reveals repository history.
  test('404s for unknown plans', async () => {
    const res = await plans.request('/plans/nope/receipt');
    expect(res.status).toBe(404);
  });

  // User story: a plan whose file was later committed to main reads as landed, with evidence.
  test('reports a plan as landed once its mentioned file reaches main', async () => {
    const res = await plans.request(`/plans/${ledgerPlanId}/receipt`);
    expect(res.status).toBe(200);
    const { receipt } = (await res.json()) as { receipt: PlanReceipt };
    expect(receipt.planId).toBe(ledgerPlanId);
    expect(receipt.status).toBe('landed');
    expect(receipt.commits.map((commit) => commit.subject)).toEqual(['Sum ledger totals']);
    expect(receipt.commits[0]?.onDefaultBranch).toBe(true);
    expect(receipt.files.changed).toEqual(['src/ledger.ts']);
  });

  // User story: list rows fetch every summary at once and match them to plans by id.
  test('summarizes receipts keyed by plan id and narrows with ?ids=', async () => {
    const all = await plans.request('/receipts');
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { receipts: Record<string, PlanReceiptSummary> };
    expect(allBody.receipts[ledgerPlanId]).toMatchObject({
      planId: ledgerPlanId,
      status: 'landed',
      changedFiles: 1,
      mentionedFiles: 1,
      commits: 1,
    });
    expect(allBody.receipts[planId]?.planId).toBe(planId);

    const subset = await plans.request(`/receipts?ids=${encodeURIComponent(ledgerPlanId)}`);
    const subsetBody = (await subset.json()) as { receipts: Record<string, PlanReceiptSummary> };
    expect(Object.keys(subsetBody.receipts)).toEqual([ledgerPlanId]);
  });
});

test('handoff CLI catalog contains only supported target IDs and labels', async () => {
  const res = await plans.request('/open-in/agent-clis');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { apps: { id: string; label: string }[] };
  expect(Array.isArray(body.apps)).toBe(true);
  for (const app of body.apps) {
    expect(['codex', 'claude']).toContain(app.id);
    expect(typeof app.label).toBe('string');
  }
});
