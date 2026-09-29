import { expect, test } from 'bun:test';
import type { Plan } from '../types.ts';
import { searchPlans } from './plan-search.ts';

function plan(partial: Partial<Plan> & Pick<Plan, 'id'>): Plan {
  return {
    agent: 'claude-code',
    title: 'Untitled plan',
    content: '## Steps\n\n1. Do the work.\n',
    filePath: `/plans/${partial.id}.md`,
    format: 'md',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    metadata: {},
    ...partial,
  };
}

function ids(plans: Plan[]): string[] {
  return plans.map((p) => p.id);
}

test('finds a phrase deep inside long content', () => {
  const filler = 'We walk through the rollout step by step. '.repeat(20);
  const deep = plan({ id: 'deep', content: `${filler}Then add rate limiting to the API.` });
  expect(deep.content.indexOf('rate limiting')).toBeGreaterThan(600);

  expect(ids(searchPlans([deep, plan({ id: 'other' })], 'Rate Limiting'))).toEqual(['deep']);
});

test('requires every term, but each term may match a different field', () => {
  const plans = [
    plan({ id: 'both', title: 'Harden login', workspace: '/repos/payments' }),
    plan({ id: 'title-only', title: 'Harden login', workspace: '/repos/search' }),
    plan({ id: 'workspace-only', title: 'Tidy styles', workspace: '/repos/payments' }),
  ];

  expect(ids(searchPlans(plans, 'login payments'))).toEqual(['both']);
  expect(searchPlans(plans, 'login billing')).toEqual([]);
});

test('treats a quoted phrase as one term', () => {
  const phrase = plan({ id: 'phrase', content: 'Add a retry queue for webhooks.' });
  const scattered = plan({ id: 'scattered', content: 'Queue the jobs, then retry failures.' });

  expect(ids(searchPlans([phrase, scattered], '"retry queue"'))).toEqual(['phrase']);
  expect(ids(searchPlans([phrase, scattered], 'retry queue')).sort()).toEqual([
    'phrase',
    'scattered',
  ]);
});

test('ranks a title hit above a plan that only mentions the term in content', () => {
  const contentOnly = plan({
    id: 'content-only',
    title: 'Refactor sessions',
    content: 'Migrate auth tokens. Rotate auth keys. Audit auth logs. Move auth. Log auth. Auth.',
    updatedAt: new Date('2026-03-01T00:00:00Z'),
  });
  const titleHit = plan({
    id: 'title-hit',
    title: 'Auth cleanup',
    updatedAt: new Date('2026-02-01T00:00:00Z'),
  });

  expect(ids(searchPlans([contentOnly, titleHit], 'auth'))).toEqual(['title-hit', 'content-only']);
});

test('breaks relevance ties by most recently updated', () => {
  const older = plan({
    id: 'older',
    title: 'Cache warmup',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  const newer = plan({
    id: 'newer',
    title: 'Cache warmup',
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  });

  expect(ids(searchPlans([older, newer], 'cache'))).toEqual(['newer', 'older']);
});

test('sees in-place content edits on an already searched plan', () => {
  const edited = plan({ id: 'edited', content: 'Draft the migration.' });
  expect(searchPlans([edited], 'backfill')).toEqual([]);

  edited.content = 'Draft the migration, then backfill old rows.';
  expect(ids(searchPlans([edited], 'backfill'))).toEqual(['edited']);
});

test('skips plans hidden as low value', () => {
  const hidden = plan({ id: 'hidden', title: 'Auth notes', metadata: { lowValue: true } });
  expect(searchPlans([hidden], 'auth')).toEqual([]);
});
