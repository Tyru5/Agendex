import { describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import type { Plan, PlanFileMatch } from '@agendex/shared';
import type { PlanReceipt, PlanReceiptStatus } from '@agendex/shared/receipts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpToolHandlers, type McpToolHandlers, type McpToolProviders } from './mcp-tools.ts';

const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const DAY = 86_400_000;
const REPO_ROOTS = ['/work/app', '/work/other'];

function makePlan(id: string, overrides: Partial<Plan> = {}): Plan {
  const updatedAt = overrides.updatedAt ?? new Date(NOW - DAY);
  return {
    id,
    agent: 'claude-code',
    title: `Plan ${id}`,
    content: `# Plan ${id}\n\nRefactor the session store.\n`,
    filePath: `/home/me/.claude/plans/${id}.md`,
    format: 'md',
    createdAt: overrides.createdAt ?? updatedAt,
    updatedAt,
    workspace: '/work/app',
    metadata: {},
    ...overrides,
  };
}

function makeReceipt(planId: string, status: PlanReceiptStatus = 'landed'): PlanReceipt {
  return {
    planId,
    status,
    ...(status === 'landed' && { confidence: 'high' as const }),
    reasons: ['2 of 3 mentioned files changed'],
    repoRoot: '/work/app',
    defaultBranch: 'main',
    window: { start: new Date(NOW - 2 * DAY).toISOString() },
    files: {
      changed: ['src/a.ts', 'src/b.ts'],
      untouched: ['src/c.ts'],
      missing: [],
      ambiguous: [],
      unplanned: ['README.md'],
      uncommitted: [],
    },
    commits: [
      {
        sha: 'abc1234',
        subject: 'Refactor session store',
        authorName: 'Dev',
        committedAt: new Date(NOW - DAY).toISOString(),
        plannedFiles: ['src/a.ts', 'src/b.ts'],
        unplannedFiles: ['README.md'],
        onDefaultBranch: true,
        sharedWithPlanIds: [],
      },
    ],
    omittedCommitCount: 2,
    landedAt: new Date(NOW - DAY).toISOString(),
    lastActivityAt: new Date(NOW - DAY).toISOString(),
    computedAt: new Date(NOW).toISOString(),
  };
}

function gitRoot(dir: string): string | null {
  return REPO_ROOTS.find((root) => dir === root || dir.startsWith(`${root}/`)) ?? null;
}

interface Harness {
  handlers: McpToolHandlers;
  receiptRequests: string[][];
  fileRequests: Array<{ filePath: string; cwd: string; planIds: string[] }>;
}

function harness(
  plans: Plan[],
  options: {
    cwd?: string;
    receipts?: Map<string, PlanReceipt>;
    fileMatches?: PlanFileMatch[];
    search?: McpToolProviders['search'];
  } = {},
): Harness {
  const receiptRequests: string[][] = [];
  const fileRequests: Harness['fileRequests'] = [];
  const receipts =
    options.receipts ?? new Map(plans.map((plan) => [plan.id, makeReceipt(plan.id)]));
  const providers: McpToolProviders = {
    cwd: options.cwd ?? '/work/app/packages/cli',
    now: () => NOW,
    plans: async () => plans,
    planById: async (id) => plans.find((plan) => plan.id === id),
    search:
      options.search ??
      ((candidates, query) =>
        candidates.filter((plan) => plan.content.toLowerCase().includes(query.toLowerCase()))),
    receipts: async (requested) => {
      receiptRequests.push(requested.map((plan) => plan.id));
      return new Map(
        requested.flatMap((plan) => {
          const receipt = receipts.get(plan.id);
          return receipt ? [[plan.id, receipt] as const] : [];
        }),
      );
    },
    receipt: async (plan) => receipts.get(plan.id) ?? makeReceipt(plan.id, 'planned'),
    plansForFile: async (filePath, { cwd, plans: candidates }) => {
      fileRequests.push({ filePath, cwd, planIds: candidates.map((plan) => plan.id) });
      return options.fileMatches ?? [];
    },
    canonicalDir: (dir) => resolve(dir),
    gitRoot,
    planRepoRoot: (plan) => gitRoot(plan.workspace ?? dirname(plan.filePath)),
    gitContext: (plan) =>
      plan.workspace?.startsWith('/work/app') ? { branch: 'main', commit: 'abc1234' } : null,
  };
  return { handlers: createMcpToolHandlers(providers), receiptRequests, fileRequests };
}

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

// Tool results are arbitrary JSON; tests index into them freely.
// oxlint-disable-next-line typescript/no-explicit-any
function data(result: CallToolResult): Record<string, any> {
  expect(result.isError).toBeFalsy();
  // The JSON text block mirrors structuredContent for clients that only read text.
  expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  return result.structuredContent ?? {};
}

function ids(result: CallToolResult): string[] {
  return data(result).plans.map((plan: { id: string }) => plan.id);
}

function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  return textOf(result);
}

const scopedPlans = [
  makePlan('app-root'),
  makePlan('app-package', { workspace: '/work/app/packages/web' }),
  // No workspace: belongs to the repo through its artifact path.
  makePlan('app-artifact', { workspace: undefined, filePath: '/work/app/docs/plans/a.md' }),
  makePlan('other', { workspace: '/work/other' }),
  makePlan('scratch', { workspace: '/scratch/notes' }),
];

describe('workspace scoping', () => {
  test('defaults to the git root of the server cwd, including subdirectories and artifacts', async () => {
    const { handlers } = harness(scopedPlans);
    const result = await handlers.search_plans({ query: 'session' });
    expect(ids(result).sort()).toEqual(['app-artifact', 'app-package', 'app-root']);
    expect(data(result).scope).toEqual({
      allWorkspaces: false,
      workspace: '/work/app',
      repoRoot: '/work/app',
    });
  });

  test('an explicit workspace overrides the cwd repo', async () => {
    const { handlers } = harness(scopedPlans);
    expect(
      ids(await handlers.search_plans({ query: 'session', workspace: '/work/other' })),
    ).toEqual(['other']);
    expect(ids(await handlers.recent_plans({ workspace: '/work/other' }))).toEqual(['other']);
  });

  test('a workspace outside any repo matches plans whose workspace is inside it', async () => {
    const { handlers } = harness(scopedPlans, { cwd: '/scratch' });
    expect(ids(await handlers.recent_plans({}))).toEqual(['scratch']);
  });

  test('all_workspaces searches every plan', async () => {
    const { handlers } = harness(scopedPlans);
    const result = await handlers.search_plans({ query: 'session', all_workspaces: true });
    expect(ids(result).sort()).toEqual(scopedPlans.map((plan) => plan.id).sort());
    expect(data(result).scope).toEqual({ allWorkspaces: true });
  });

  test('agent filter matches the plan agent', async () => {
    const plans = [makePlan('claude'), makePlan('codex', { agent: 'codex' })];
    const { handlers } = harness(plans);
    expect(ids(await handlers.search_plans({ query: 'session', agent: 'codex' }))).toEqual([
      'codex',
    ]);
    expect(ids(await handlers.recent_plans({ agent: 'codex' }))).toEqual(['codex']);
  });
});

describe('search_plans', () => {
  test('keeps search ranking, adds snippets, and attaches receipt summaries', async () => {
    const plans = [
      makePlan('low', { content: `${'intro '.repeat(40)}the session store moves` }),
      makePlan('high'),
    ];
    const { handlers } = harness(plans, {
      search: (candidates) => [...candidates].reverse(),
    });
    const result = data(await handlers.search_plans({ query: 'session' }));
    expect(result.plans.map((plan: { id: string }) => plan.id)).toEqual(['high', 'low']);
    const low = result.plans[1];
    expect(low.snippet.startsWith('…')).toBe(true);
    expect(low.snippet).toContain('the session store moves');
    expect(low.receipt).toEqual({
      planId: 'low',
      status: 'landed',
      confidence: 'high',
      changedFiles: 2,
      mentionedFiles: 3,
      commits: 3,
      landedAt: new Date(NOW - DAY).toISOString(),
      lastActivityAt: new Date(NOW - DAY).toISOString(),
    });
  });

  test('receipt is null when no receipt was computed for a plan', async () => {
    const { handlers } = harness([makePlan('a')], { receipts: new Map() });
    expect(data(await handlers.search_plans({ query: 'session' })).plans[0].receipt).toBeNull();
  });

  test('clamps limit to 1..50, defaults to 10, and only computes receipts for returned plans', async () => {
    const plans = Array.from({ length: 60 }, (_, index) => makePlan(`p${index}`));
    const { handlers, receiptRequests } = harness(plans);

    const defaulted = data(await handlers.search_plans({ query: 'session' }));
    expect(defaulted.plans).toHaveLength(10);
    expect(defaulted.total).toBe(60);
    expect(receiptRequests.at(-1)).toHaveLength(10);

    expect(data(await handlers.search_plans({ query: 'session', limit: 500 })).plans).toHaveLength(
      50,
    );
    expect(data(await handlers.search_plans({ query: 'session', limit: 0 })).plans).toHaveLength(1);
    expect(data(await handlers.recent_plans({ limit: -3 })).plans).toHaveLength(1);
    expect(data(await handlers.recent_plans({ limit: 99 })).plans).toHaveLength(50);
  });

  test('rejects an empty query', async () => {
    const { handlers } = harness([makePlan('a')]);
    expect(errorText(await handlers.search_plans({ query: '   ' }))).toContain('query is empty');
  });
});

describe('get_plan', () => {
  const plan = makePlan('big', {
    content: 'x'.repeat(70_000),
    metadata: { sessionId: 'session-1' },
  });

  test('returns metadata and the full receipt', async () => {
    const { handlers } = harness([plan]);
    const result = data(await handlers.get_plan({ id: 'big', max_chars: 100_000 }));
    expect(result).toMatchObject({
      id: 'big',
      agent: 'claude-code',
      workspace: '/work/app',
      filePath: plan.filePath,
      sessionId: 'session-1',
      git: { branch: 'main', commit: 'abc1234' },
      totalChars: 70_000,
      truncated: false,
    });
    expect(result.content).toHaveLength(70_000);
    expect(result.notice).toBeUndefined();
    expect(result.receipt).toEqual(makeReceipt('big'));
  });

  test('truncates at 60k characters by default with a notice', async () => {
    const { handlers } = harness([plan]);
    const result = data(await handlers.get_plan({ id: 'big' }));
    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(60_000);
    expect(result.notice).toContain('first 60,000 of 70,000 characters');
  });

  test('honors a smaller max_chars', async () => {
    const { handlers } = harness([plan]);
    const result = data(await handlers.get_plan({ id: 'big', max_chars: 10 }));
    expect(result.content).toBe('x'.repeat(10));
    expect(result.truncated).toBe(true);
  });

  test('unknown id is a tool error that points to the finder tools', async () => {
    const { handlers } = harness([plan]);
    const message = errorText(await handlers.get_plan({ id: 'nope' }));
    expect(message).toContain('No plan with id "nope"');
    expect(message).toContain('search_plans');
  });
});

describe('plans_for_file', () => {
  const mentions = makePlan('mentions');
  const committed = makePlan('committed');
  const plans = [mentions, committed, makePlan('other', { workspace: '/work/other' })];

  test('passes match flags through with receipt summaries', async () => {
    const { handlers } = harness(plans, {
      fileMatches: [
        { plan: mentions, mentioned: true, changedByPlanCommits: false },
        { plan: committed, mentioned: false, changedByPlanCommits: true },
      ],
    });
    const result = data(await handlers.plans_for_file({ path: 'src/a.ts' }));
    expect(result.total).toBe(2);
    expect(
      result.plans.map(
        (plan: { id: string; mentioned: boolean; changedByPlanCommits: boolean }) => [
          plan.id,
          plan.mentioned,
          plan.changedByPlanCommits,
        ],
      ),
    ).toEqual([
      ['mentions', true, false],
      ['committed', false, true],
    ]);
    expect(result.plans[1].receipt.status).toBe('landed');
  });

  test('resolves relative paths against the cwd repo root by default, or the given workspace', async () => {
    const { handlers, fileRequests } = harness(plans);
    await handlers.plans_for_file({ path: 'src/a.ts' });
    await handlers.plans_for_file({ path: 'lib/b.ts', workspace: '/work/other' });
    expect(fileRequests.map(({ filePath, cwd }) => [filePath, cwd])).toEqual([
      ['src/a.ts', '/work/app'],
      ['lib/b.ts', '/work/other'],
    ]);
    // The file decides the repo, so every indexed plan is a candidate.
    expect(fileRequests[0]?.planIds).toEqual(['mentions', 'committed', 'other']);
  });
});

describe('recent_plans', () => {
  const plans = [
    makePlan('old', { updatedAt: new Date(NOW - 20 * DAY) }),
    makePlan('newest', { updatedAt: new Date(NOW - 1000) }),
    makePlan('week', { updatedAt: new Date(NOW - 6 * DAY) }),
  ];

  test('orders by last update, newest first', async () => {
    const { handlers } = harness(plans);
    expect(ids(await handlers.recent_plans({}))).toEqual(['newest', 'week', 'old']);
  });

  test('since accepts ISO dates and relative windows', async () => {
    const { handlers } = harness(plans);
    const iso = data(await handlers.recent_plans({ since: '2026-09-20T00:00:00Z' }));
    expect(iso.plans.map((plan: { id: string }) => plan.id)).toEqual(['newest', 'week']);
    expect(iso.total).toBe(2);
    expect(iso.since).toBe('2026-09-20T00:00:00.000Z');
    expect(ids(await handlers.recent_plans({ since: '2d' }))).toEqual(['newest']);
    expect(ids(await handlers.recent_plans({ since: '1w' }))).toEqual(['newest', 'week']);
  });

  test('an unreadable since is a tool error', async () => {
    const { handlers } = harness(plans);
    expect(errorText(await handlers.recent_plans({ since: 'last tuesday' }))).toContain(
      "Can't read since",
    );
  });
});
