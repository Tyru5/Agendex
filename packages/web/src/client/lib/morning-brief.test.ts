import { expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import {
  buildMorningBrief,
  extractBriefChecklist,
  hasMorningBriefUpdates,
  MORNING_BRIEF_DEFAULT_LOOKBACK_MS,
  MORNING_BRIEF_MAX_LOOKBACK_MS,
  resolveMorningBriefSince,
} from './morning-brief.ts';

function makePlan(overrides: Partial<Plan> & { id: string }): Plan {
  return {
    agent: 'codex-cli',
    title: overrides.id,
    content: '',
    filePath: `/tmp/${overrides.id}.md`,
    format: 'md',
    createdAt: '2026-08-19T06:00:00.000Z',
    updatedAt: '2026-08-20T06:00:00.000Z',
    workspace: '/repo',
    metadata: {},
    ...overrides,
  };
}

test('extractBriefChecklist reads markdown tasks and cleans the next step', () => {
  expect(
    extractBriefChecklist(`
- [x] Inspect the existing flow
- [ ] Implement \`retryRequest\`
1. [ ] Add [coverage](https://example.com)
* [X] Ship the docs
`),
  ).toEqual({
    total: 4,
    completed: 2,
    remaining: 2,
    nextStep: 'Implement retryRequest',
  });
});

test('buildMorningBrief classifies activity and ranks resumable plans', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  const plans = [
    makePlan({
      id: 'in-progress',
      title: 'Retry API requests',
      createdAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
      content: '- [x] Reproduce\n- [ ] Add backoff',
    }),
    makePlan({
      id: 'complete',
      createdAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-20T09:00:00.000Z',
      content: '- [x] Implement\n- [x] Test',
    }),
    makePlan({
      id: 'new-plan',
      createdAt: '2026-08-20T08:00:00.000Z',
      updatedAt: '2026-08-20T08:00:00.000Z',
    }),
    makePlan({
      id: 'old',
      createdAt: '2026-08-18T08:00:00.000Z',
      updatedAt: '2026-08-19T08:00:00.000Z',
    }),
  ];

  const brief = buildMorningBrief(plans, since, until);
  expect(brief.planCount).toBe(3);
  expect(brief.newPlanCount).toBe(1);
  expect(brief.updatedPlanCount).toBe(2);
  expect(brief.pickups.map((activity) => activity.plan.id)).toEqual(['in-progress', 'new-plan']);
  expect(brief.pickups[0]?.checklist.nextStep).toBe('Add backoff');
  expect(brief.closedLoops.map((activity) => activity.plan.id)).toEqual(['complete']);
  expect(brief.activity.map((activity) => activity.plan.id)).toEqual([
    'new-plan',
    'complete',
    'in-progress',
  ]);
});

test('buildMorningBrief finds workspaces touched by multiple agents', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  const brief = buildMorningBrief(
    [
      makePlan({ id: 'a', agent: 'codex-cli', updatedAt: '2026-08-20T10:00:00.000Z' }),
      makePlan({ id: 'b', agent: 'claude-code', updatedAt: '2026-08-20T09:00:00.000Z' }),
      makePlan({
        id: 'c',
        agent: 'cursor',
        workspace: '/solo',
        updatedAt: '2026-08-20T08:00:00.000Z',
      }),
    ],
    since,
    until,
  );

  expect(brief.relays).toHaveLength(1);
  expect(brief.relays[0]?.workspace).toBe('/repo');
  expect(brief.relays[0]?.agents).toEqual(['codex-cli', 'claude-code']);
  expect(brief.relays[0]?.plans.map((plan) => plan.id)).toEqual(['a', 'b']);
});

test('resolveMorningBriefSince defaults to one day and caps long absences', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  expect(resolveMorningBriefSince(null, now)).toBe(now - MORNING_BRIEF_DEFAULT_LOOKBACK_MS);
  expect(resolveMorningBriefSince(now - 2 * MORNING_BRIEF_DEFAULT_LOOKBACK_MS, now)).toBe(
    now - 2 * MORNING_BRIEF_DEFAULT_LOOKBACK_MS,
  );
  expect(resolveMorningBriefSince(now - 30 * MORNING_BRIEF_DEFAULT_LOOKBACK_MS, now)).toBe(
    now - MORNING_BRIEF_MAX_LOOKBACK_MS,
  );
  expect(resolveMorningBriefSince(now + 1, now)).toBe(now - MORNING_BRIEF_DEFAULT_LOOKBACK_MS);
});

test('hasMorningBriefUpdates ignores plans outside the window', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  expect(
    hasMorningBriefUpdates(
      [makePlan({ id: 'recent', updatedAt: '2026-08-20T09:00:00.000Z' })],
      since,
      until,
    ),
  ).toBe(true);
  expect(
    hasMorningBriefUpdates(
      [makePlan({ id: 'old', updatedAt: '2026-08-19T09:00:00.000Z' })],
      since,
      until,
    ),
  ).toBe(false);
});

test('the read boundary is exclusive so acknowledged activity does not return', () => {
  const since = Date.parse('2026-08-20T06:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  const acknowledged = makePlan({
    id: 'acknowledged',
    updatedAt: new Date(since).toISOString(),
  });

  expect(buildMorningBrief([acknowledged], since, until).planCount).toBe(0);
  expect(hasMorningBriefUpdates([acknowledged], since, until)).toBe(false);
});
