import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalPlanAgent,
  dedupePlanBrowseCandidates,
  dedupePlanDownloadCandidates,
  isExactPlanDownloadIdHit,
  looksLikePlanIdQuery,
  normalizePlanLookupText,
  parsePlanDownloadQuery,
  planAgentLookupValues,
  planAgentsMatch,
  planBrowseDedupeKeys,
  scorePlanTitleSimilarity,
  selectPlanDownloadMatches,
  selectPlanDownloadTitlePage,
  filterPlanBrowseMatches,
  suggestClosestPlans,
  type PlanDownloadLookupCandidate,
} from './plan-download-lookup.ts';

function plan(
  partial: Partial<PlanDownloadLookupCandidate> & Pick<PlanDownloadLookupCandidate, 'id' | 'title'>,
): PlanDownloadLookupCandidate {
  return {
    agent: 'claude-code',
    updatedAt: 1,
    ...partial,
  };
}

test('parsePlanDownloadQuery extracts a known agent prefix', () => {
  expect(parsePlanDownloadQuery('claude-code/Add auth')).toEqual({
    query: 'Add auth',
    agent: 'claude-code',
  });
  expect(parsePlanDownloadQuery('codex: Ship download command')).toEqual({
    query: 'Ship download command',
    agent: 'codex-cli',
  });
  expect(parsePlanDownloadQuery('cursor | Rename sync cache')).toEqual({
    query: 'Rename sync cache',
    agent: 'cursor',
  });
});

test('parsePlanDownloadQuery keeps multiword titles with an agent-like suffix', () => {
  expect(parsePlanDownloadQuery('Migration notes: codex')).toEqual({
    query: 'Migration notes: codex',
  });
  expect(parsePlanDownloadQuery('Add auth / claude-code')).toEqual({
    query: 'Add auth / claude-code',
  });
});

test('parsePlanDownloadQuery extracts a single-token title with an agent suffix', () => {
  expect(parsePlanDownloadQuery('Auth / claude-code')).toEqual({
    query: 'Auth',
    agent: 'claude-code',
  });
});

test('parsePlanDownloadQuery leaves ordinary titles alone', () => {
  expect(parsePlanDownloadQuery('API/Auth refactor')).toEqual({
    query: 'API/Auth refactor',
  });
  expect(parsePlanDownloadQuery('just a title')).toEqual({
    query: 'just a title',
  });
});

test('plan-download-lookup stays Convex-safe and does not import the Node adapter catalog', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'plan-download-lookup.ts'),
    'utf8',
  );
  expect(source).not.toContain('adapters/catalog.ts');
  expect(source).toContain('adapters/agent-ids');
  expect(source).not.toContain('adapters/agent-ids.ts');
});

test('normalized title keys collapse case and repeated whitespace', () => {
  expect(normalizePlanLookupText('  Add   AUTH\nFlow  ')).toBe('add auth flow');
});

test('canonicalPlanAgent maps adapter aliases', () => {
  expect(canonicalPlanAgent('codex')).toBe('codex-cli');
  expect(canonicalPlanAgent('codex-cli')).toBe('codex-cli');
  expect(canonicalPlanAgent('GITHUB-COPILOT')).toBe('copilot-chat');
});

test('planAgentsMatch treats adapter ids and aliases as the same agent', () => {
  expect(planAgentsMatch('codex-cli', 'codex')).toBe(true);
  expect(planAgentsMatch('claude-code', 'cursor')).toBe(false);
  expect(planAgentsMatch('MyAgent', 'myagent')).toBe(true);
});

test('planAgentLookupValues includes adapter ids and stored aliases', () => {
  expect(planAgentLookupValues('codex').toSorted()).toEqual(['codex', 'codex-cli']);
  expect(planAgentLookupValues('codex-cli').toSorted()).toEqual(['codex', 'codex-cli']);
  expect(planAgentLookupValues('claude-code')).toEqual(['claude-code']);
  expect(planAgentLookupValues('  ')).toEqual([]);
  expect(planAgentLookupValues('commandcode')).toContain('command-code');
  expect(planAgentLookupValues('command-code')).toContain('commandcode');
});

test('selectPlanDownloadMatches prefers an exact id or localPlanId', () => {
  const plans = [
    plan({ id: 'cloud-1', title: 'Add auth', localPlanId: 'local-1' }),
    plan({ id: 'cloud-2', title: 'cloud-1' }),
  ];

  expect(selectPlanDownloadMatches(plans, 'cloud-1')).toEqual({
    kind: 'one',
    plan: plans[0],
  });
  expect(selectPlanDownloadMatches(plans, 'local-1')).toEqual({
    kind: 'one',
    plan: plans[0],
  });
  expect(selectPlanDownloadMatches(plans, 'cloud-1', 'cursor')).toEqual({ kind: 'none' });
  expect(selectPlanDownloadMatches(plans, 'local-1', 'cursor')).toEqual({ kind: 'none' });
});

test('dedupePlanDownloadCandidates collapses the same document id without identity fields', () => {
  const first = plan({ id: 'same', title: 'Add auth', updatedAt: 1 });
  const again = plan({ id: 'same', title: 'Add auth', updatedAt: 1 });
  const unique = dedupePlanDownloadCandidates([first, again]);
  expect(unique).toHaveLength(1);
  expect(selectPlanDownloadMatches(unique, 'Add auth')).toEqual({ kind: 'one', plan: first });
});

test('dedupePlanDownloadCandidates collapses duplicate sync identities before title select', () => {
  const older = plan({
    id: 'old',
    title: 'Add auth',
    syncIdentityKey: 'sync-1',
    updatedAt: 1,
  });
  const newer = plan({
    id: 'new',
    title: 'Add auth',
    syncIdentityKey: 'sync-1',
    updatedAt: 2,
  });
  const unique = dedupePlanDownloadCandidates([older, newer]);
  expect(unique).toEqual([newer]);
  expect(selectPlanDownloadMatches(unique, 'Add auth')).toEqual({ kind: 'one', plan: newer });
});

test('planBrowseDedupeKeys exposes every identity a row answers to', () => {
  const synced = plan({
    id: 'p1',
    title: 'Add auth',
    syncIdentityKey: 'sync-1',
    contentHash: 'hash-1',
  });
  const keys = planBrowseDedupeKeys(synced);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe('sync:sync-1');
  expect(keys[1]).toStartWith('exact:');

  const unsynced = plan({ id: 'p2', title: 'Add auth', contentHash: 'hash-1' });
  const unsyncedKeys = planBrowseDedupeKeys(unsynced);
  expect(unsyncedKeys).toEqual([keys[1] as string]);

  expect(planBrowseDedupeKeys(plan({ id: 'p3', title: 'Bare' }))).toEqual(['id:p3']);
});

test('dedupePlanBrowseCandidates keeps identity keys from discarded duplicates', () => {
  const winner = plan({
    id: 'w',
    title: 'Add auth',
    syncIdentityKey: 'sync-1',
    contentHash: 'hash-new',
    updatedAt: 2,
  });
  const loser = plan({
    id: 'l',
    title: 'Add auth',
    syncIdentityKey: 'sync-1',
    contentHash: 'hash-old',
    updatedAt: 1,
  });
  const result = dedupePlanBrowseCandidates([winner, loser]);
  expect(result).toHaveLength(1);
  expect(result[0]?.plan).toEqual(winner);
  expect(result[0]?.dedupeKeys).toEqual(
    expect.arrayContaining([...planBrowseDedupeKeys(winner), ...planBrowseDedupeKeys(loser)]),
  );
});

test('dedupePlanBrowseCandidates can source keys from rows removed by filtering', () => {
  const kept = plan({
    id: 'k',
    title: 'Add auth',
    syncIdentityKey: 'sync-1',
    contentHash: 'hash-1',
    updatedAt: 1,
  });
  const filteredOut = plan({
    id: 'f',
    title: 'Add auth',
    syncIdentityKey: 'sync-1',
    contentHash: 'hash-2',
    updatedAt: 2,
  });
  const result = dedupePlanBrowseCandidates([kept], [kept, filteredOut]);
  expect(result).toHaveLength(1);
  expect(result[0]?.plan).toEqual(kept);
  expect(result[0]?.dedupeKeys).toEqual(expect.arrayContaining(planBrowseDedupeKeys(filteredOut)));
});

test('isExactPlanDownloadIdHit is only true for id or localPlanId', () => {
  const hit = plan({ id: 'cloud-1', title: 'Add auth', localPlanId: 'local-1' });
  expect(isExactPlanDownloadIdHit(hit, 'cloud-1')).toBe(true);
  expect(isExactPlanDownloadIdHit(hit, 'local-1')).toBe(true);
  expect(isExactPlanDownloadIdHit(hit, 'Add auth')).toBe(false);
});

test('looksLikePlanIdQuery treats ID-shaped titles as ids', () => {
  expect(looksLikePlanIdQuery('AuthenticationFlow')).toBe(true);
});

test('selectPlanDownloadMatches finds an ID-shaped title substring', () => {
  const plans = [plan({ id: '1', title: 'ImplementAuthenticationFlow' })];
  expect(selectPlanDownloadMatches(plans, 'AuthenticationFlow')).toEqual({
    kind: 'one',
    plan: plans[0],
  });
});

test('selectPlanDownloadMatches finds a unique title case-insensitively', () => {
  const plans = [plan({ id: '1', title: 'Add Auth Flow' }), plan({ id: '2', title: 'Unrelated' })];

  expect(selectPlanDownloadMatches(plans, 'add auth flow')).toEqual({
    kind: 'one',
    plan: plans[0],
  });
});

test('selectPlanDownloadMatches uses a unique prefix or substring', () => {
  const plans = [
    plan({ id: '1', title: 'Download cloud plans' }),
    plan({ id: '2', title: 'Unrelated note' }),
  ];

  expect(selectPlanDownloadMatches(plans, 'Download')).toEqual({
    kind: 'one',
    plan: plans[0],
  });
  expect(selectPlanDownloadMatches(plans, 'cloud plans')).toEqual({
    kind: 'one',
    plan: plans[0],
  });
});

test('selectPlanDownloadMatches uses agent to disambiguate the same title', () => {
  const plans = [
    plan({ id: '1', title: 'Add auth', agent: 'claude-code', updatedAt: 2 }),
    plan({ id: '2', title: 'Add auth', agent: 'codex-cli', updatedAt: 3 }),
  ];

  expect(selectPlanDownloadMatches(plans, 'Add auth')).toEqual({
    kind: 'many',
    plans: [plans[1], plans[0]],
  });
  expect(selectPlanDownloadMatches(plans, 'Add auth', 'codex')).toEqual({
    kind: 'one',
    plan: plans[1],
  });
});

test('selectPlanDownloadMatches returns none for an empty query', () => {
  expect(selectPlanDownloadMatches([plan({ id: '1', title: 'Add auth' })], '   ')).toEqual({
    kind: 'none',
  });
});

test('selectPlanDownloadMatches does not treat unrelated leftover plans as hits', () => {
  expect(
    selectPlanDownloadMatches(
      [plan({ id: '1', title: 'Unrelated note' }), plan({ id: '2', title: 'Something else' })],
      'Add auth',
    ),
  ).toEqual({ kind: 'none' });
});

test('filterPlanBrowseMatches keeps exact and substring hits on the same page', () => {
  const exact = plan({ id: '1', title: 'auth' });
  const substring = plan({ id: '2', title: 'Add auth flow' });
  const unrelated = plan({ id: '3', title: 'Weekly retro' });
  expect(
    filterPlanBrowseMatches([exact, substring, unrelated], 'auth').map((item) => item.id),
  ).toEqual(['1', '2']);
});

test('filterPlanBrowseMatches still honors the agent filter', () => {
  const claude = plan({ id: '1', title: 'Add auth', agent: 'claude-code' });
  const cursor = plan({ id: '2', title: 'Add auth flow', agent: 'cursor' });
  expect(
    filterPlanBrowseMatches([claude, cursor], 'auth', 'claude-code').map((item) => item.id),
  ).toEqual(['1']);
});

test('scorePlanTitleSimilarity ranks typos above unrelated titles', () => {
  expect(scorePlanTitleSimilarity('Add autth', 'Add auth')).toBeGreaterThan(0.7);
  expect(scorePlanTitleSimilarity('Add autth', 'Add auth')).toBeGreaterThan(
    scorePlanTitleSimilarity('Add autth', 'Weekly retro notes'),
  );
});

test('suggestClosestPlans returns the closest titles and skips weak ones', () => {
  const plans = [
    plan({ id: '1', title: 'Add auth', agent: 'claude-code', updatedAt: 2 }),
    plan({ id: '2', title: 'Add authentication flow', agent: 'codex-cli', updatedAt: 3 }),
    plan({ id: '3', title: 'Weekly retro notes', updatedAt: 4 }),
  ];

  expect(suggestClosestPlans(plans, 'Add autth').map((item) => item.id)).toEqual(['1', '2']);
  expect(suggestClosestPlans(plans, 'zzzz-no-such-plan')).toEqual([]);
  expect(suggestClosestPlans(plans, 'k57abc123def4567')).toEqual([]);
});

test('suggestClosestPlans prefers the requested agent when titles are equally close', () => {
  const plans = [
    plan({ id: '1', title: 'Add auth', agent: 'claude-code', updatedAt: 4 }),
    plan({ id: '2', title: 'Add auth', agent: 'codex-cli', updatedAt: 3 }),
  ];

  expect(suggestClosestPlans(plans, 'Add autth', 'codex').map((item) => item.id)).toEqual([
    '2',
    '1',
  ]);
});

test('an indexed title page stays bounded for large accounts', () => {
  const firstPage = Array.from({ length: 8 }, (_, index) =>
    plan({
      id: `match-${index}`,
      title: 'Add auth',
      updatedAt: 2000 + index,
    }),
  );

  const result = selectPlanDownloadTitlePage(firstPage, false);
  expect(result.kind).toBe('many');
  if (result.kind !== 'many') throw new Error('expected many');
  expect(result.plans).toHaveLength(8);
  expect(result.hasMore).toBe(true);
});

test('duplicate exact titles are explicit when the indexed page is complete', () => {
  const first = plan({ id: 'first', title: 'Add auth', updatedAt: 3 });
  const duplicate = plan({ id: 'second', title: 'Add auth', updatedAt: 1 });

  expect(selectPlanDownloadTitlePage([first, duplicate], true)).toEqual({
    kind: 'many',
    plans: [first, duplicate],
    hasMore: false,
  });
});

test('a single exact-title match is selected only after the indexed page is complete', () => {
  const match = plan({ id: 'only', title: 'Add auth' });
  expect(selectPlanDownloadTitlePage([match], false)).toEqual({
    kind: 'many',
    plans: [match],
    hasMore: true,
  });
  expect(selectPlanDownloadTitlePage([match], true)).toEqual({ kind: 'one', plan: match });
});
