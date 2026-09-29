import { expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import {
  applyPlanFilters,
  collectionMoveIndex,
  deriveFilterChips,
  sortForCollectionFilter,
  sortPlansByIdOrder,
  workspacesFromPlans,
} from './plan-filters.ts';

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

test('sortPlansByIdOrder follows the id order and keeps unlisted plans after it in input order', () => {
  const plans = ['stray-1', 'c', 'a', 'stray-2', 'b'].map((id) => makePlan({ id }));

  expect(sortPlansByIdOrder(plans, ['b', 'missing', 'a', 'c']).map((plan) => plan.id)).toEqual([
    'b',
    'a',
    'c',
    'stray-1',
    'stray-2',
  ]);
});

test('collectionMoveIndex lands a plan next to its visible neighbour across hidden plans', () => {
  const order = ['a', 'hidden', 'b', 'c'];
  const move = (planId: string, targetPlanId: string) => {
    const toIndex = collectionMoveIndex(order, planId, targetPlanId);
    if (toIndex === null) return null;
    const next = order.filter((id) => id !== planId);
    next.splice(toIndex, 0, planId);
    return next;
  };

  // Visible list is a, b, c: moving c up and a down each swap it with its visible neighbour.
  expect(move('c', 'b')).toEqual(['a', 'hidden', 'c', 'b']);
  expect(move('a', 'b')).toEqual(['hidden', 'b', 'a', 'c']);
  expect(move('b', 'a')).toEqual(['b', 'a', 'hidden', 'c']);
  expect(collectionMoveIndex(order, 'a', 'a')).toBeNull();
  expect(collectionMoveIndex(order, 'outside', 'a')).toBeNull();
  expect(collectionMoveIndex(order, 'a', 'outside')).toBeNull();
});

test('sortForCollectionFilter defaults collection views to collection order without overriding picks', () => {
  expect(sortForCollectionFilter('updatedAt', 'collection-a')).toBe('collection');
  expect(sortForCollectionFilter('title', 'collection-a')).toBe('title');
  expect(sortForCollectionFilter('collection', 'collection-b')).toBe('collection');
  expect(sortForCollectionFilter('collection', undefined)).toBe('updatedAt');
  expect(sortForCollectionFilter('createdAt', undefined)).toBe('createdAt');
});
