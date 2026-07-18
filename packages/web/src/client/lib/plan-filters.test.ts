import { expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import { applyPlanFilters, deriveFilterChips, workspacesFromPlans } from './plan-filters.ts';

function makePlan(overrides: Partial<Plan>): Plan {
  return {
    id: 'p1',
    agent: 'claude',
    title: 'Untitled',
    content: '',
    filePath: '',
    format: 'markdown',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

test('applyPlanFilters ANDs dimensions while ORing agents tags and content matches', () => {
  const now = Date.now();
  const plans = [
    makePlan({
      id: 'match-title',
      agent: 'claude',
      title: 'Auth redirect',
      workspace: '/repo',
      updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    makePlan({
      id: 'match-content',
      agent: 'codex',
      title: 'Callback notes',
      workspace: '/repo',
      updatedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    makePlan({
      id: 'wrong-agent',
      agent: 'cursor',
      title: 'Auth redirect',
      workspace: '/repo',
      updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    makePlan({
      id: 'wrong-tag',
      agent: 'codex',
      title: 'Auth redirect',
      workspace: '/repo',
      updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    makePlan({
      id: 'wrong-collection',
      agent: 'claude',
      title: 'Auth redirect',
      workspace: '/repo',
      updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ];

  const result = applyPlanFilters(plans, {
    q: 'auth',
    contentMatchIds: new Set(['match-content']),
    agents: ['claude', 'codex'],
    workspace: '/repo',
    date: '7d',
    tagIds: ['tag-a', 'tag-b'],
    planTagsById: {
      'match-title': [{ _id: 'tag-a' }],
      'match-content': [{ _id: 'tag-b' }],
      'wrong-agent': [{ _id: 'tag-a' }],
      'wrong-tag': [{ _id: 'tag-c' }],
      'wrong-collection': [{ _id: 'tag-a' }],
    },
    collectionId: 'collection-a',
    collectionMemberIds: new Set(['match-title', 'match-content', 'wrong-agent', 'wrong-tag']),
  });

  expect(result.map((plan) => plan.id)).toEqual(['match-title', 'match-content']);
});

test('applyPlanFilters treats empty agents as all agents', () => {
  const plans = [
    makePlan({ id: 'claude', agent: 'claude' }),
    makePlan({ id: 'codex', agent: 'codex' }),
  ];

  expect(applyPlanFilters(plans, { agents: [] }).map((plan) => plan.id)).toEqual([
    'claude',
    'codex',
  ]);
});

test('applyPlanFilters applies date bucket to updatedAt only', () => {
  const now = Date.now();
  const plans = [
    makePlan({
      id: 'recent-update',
      createdAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    makePlan({
      id: 'old-update',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ];

  expect(applyPlanFilters(plans, { date: '7d' }).map((plan) => plan.id)).toEqual(['recent-update']);
});

test('applyPlanFilters requires exact workspace match and excludes plans without workspace', () => {
  const plans = [
    makePlan({ id: 'repo', workspace: '/repo' }),
    makePlan({ id: 'repo-child', workspace: '/repo/client' }),
    makePlan({ id: 'empty', workspace: '' }),
    makePlan({ id: 'missing', workspace: undefined }),
  ];

  expect(applyPlanFilters(plans, { workspace: '/repo' }).map((plan) => plan.id)).toEqual(['repo']);
});

test('applyPlanFilters keeps plans without workspace when workspace filter is unset', () => {
  const plans = [
    makePlan({ id: 'repo', workspace: '/repo' }),
    makePlan({ id: 'missing', workspace: undefined }),
  ];

  expect(applyPlanFilters(plans, {}).map((plan) => plan.id)).toEqual(['repo', 'missing']);
});

test('workspacesFromPlans returns distinct sorted non-empty workspaces', () => {
  const plans = [
    makePlan({ id: 'b', workspace: '/zeta' }),
    makePlan({ id: 'a', workspace: '/alpha' }),
    makePlan({ id: 'dup', workspace: ' /alpha ' }),
    makePlan({ id: 'empty', workspace: '' }),
    makePlan({ id: 'missing', workspace: undefined }),
  ];

  expect(workspacesFromPlans(plans)).toEqual(['/alpha', '/zeta']);
});

test('deriveFilterChips returns only non-default active values with labels', () => {
  expect(
    deriveFilterChips(
      {
        q: ' auth ',
        agents: ['claude', 'codex'],
        workspace: '/repo',
        date: '7d',
        tagIds: ['tag-a'],
        collectionId: 'collection-a',
      },
      {
        agents: { claude: 'Claude', codex: 'Codex' },
        tags: { 'tag-a': 'Backend' },
        collections: { 'collection-a': 'Launch' },
      },
    ),
  ).toEqual([
    { key: 'search', kind: 'search', value: 'auth', label: 'auth' },
    { key: 'agent:claude', kind: 'agent', value: 'claude', label: 'Claude' },
    { key: 'agent:codex', kind: 'agent', value: 'codex', label: 'Codex' },
    { key: 'workspace:/repo', kind: 'workspace', value: '/repo', label: '/repo' },
    { key: 'date:7d', kind: 'date', value: '7d', label: '7d' },
    { key: 'tag:tag-a', kind: 'tag', value: 'tag-a', label: 'Backend' },
    {
      key: 'collection:collection-a',
      kind: 'collection',
      value: 'collection-a',
      label: 'Launch',
    },
  ]);

  expect(deriveFilterChips({ q: '', agents: [], date: 'all', tagIds: [] })).toEqual([]);
});
