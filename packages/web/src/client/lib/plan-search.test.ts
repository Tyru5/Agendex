import { expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import { filterPlans } from './plan-search.ts';

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

test('filterPlans matches content by substring when content is present', () => {
  const plans = [
    makePlan({ id: 'a', title: 'One', content: 'refactor the auth flow' }),
    makePlan({ id: 'b', title: 'Two', content: 'unrelated body' }),
  ];
  expect(filterPlans(plans, 'auth').map((p) => p.id)).toEqual(['a']);
});

test('filterPlans counts contentMatchIds as content matches when content is absent', () => {
  // Cloud mode: list items ship without content, server-side search supplies ids.
  const plans = [
    makePlan({ id: 'a', title: 'One' }),
    makePlan({ id: 'b', title: 'Two' }),
    makePlan({ id: 'c', title: 'Three' }),
  ];
  const result = filterPlans(plans, 'auth', new Set(['b']));
  expect(result.map((p) => p.id)).toEqual(['b']);
});

test('filterPlans unions metadata matches with contentMatchIds', () => {
  const plans = [
    makePlan({ id: 'a', title: 'Auth plan' }), // title match
    makePlan({ id: 'b', title: 'Two' }), // content match via server ids
    makePlan({ id: 'c', title: 'Three' }), // no match
  ];
  const result = filterPlans(plans, 'auth', new Set(['b']));
  expect(result.map((p) => p.id)).toEqual(['a', 'b']);
});

test('filterPlans without contentMatchIds keeps prior behavior', () => {
  const plans = [makePlan({ id: 'a', title: 'Auth plan' }), makePlan({ id: 'b', title: 'Two' })];
  expect(filterPlans(plans, 'auth').map((p) => p.id)).toEqual(['a']);
  expect(filterPlans(plans, '').map((p) => p.id)).toEqual(['a', 'b']);
});
