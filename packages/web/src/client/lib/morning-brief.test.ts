import { expect, test } from 'bun:test';
import type { PlanReceiptSummary } from '@agendex/shared/receipts';
import type { Plan } from './api.ts';
import {
  buildMorningBrief,
  closedLoopEvidenceLabel,
  hasMorningBriefUpdates,
  MORNING_BRIEF_DEFAULT_LOOKBACK_MS,
  MORNING_BRIEF_MAX_LOOKBACK_MS,
  morningBriefMarkReadState,
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

test('buildMorningBrief uses checklist summaries for content-less cloud rows', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  const brief = buildMorningBrief(
    [
      makePlan({
        id: 'cloud-open',
        updatedAt: '2026-08-20T10:00:00.000Z',
        checklist: { total: 3, completed: 1, nextStep: 'Add backoff' },
      }),
      makePlan({
        id: 'cloud-done',
        updatedAt: '2026-08-20T09:00:00.000Z',
        checklist: { total: 2, completed: 2 },
      }),
    ],
    since,
    until,
  );

  expect(brief.pickups.map((activity) => activity.plan.id)).toEqual(['cloud-open']);
  expect(brief.pickups[0]?.checklist).toEqual({
    total: 3,
    completed: 1,
    remaining: 2,
    nextStep: 'Add backoff',
  });
  expect(brief.closedLoops.map((activity) => activity.plan.id)).toEqual(['cloud-done']);
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

function makeReceipt(
  overrides: Partial<PlanReceiptSummary> & Pick<PlanReceiptSummary, 'planId' | 'status'>,
): PlanReceiptSummary {
  return { changedFiles: 0, mentionedFiles: 3, commits: 0, ...overrides };
}

test('a plan that landed in the window is a closed loop even if its file never changed', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  // The plan file was last written the day before; only git moved since.
  const plan = makePlan({ id: 'shipped', updatedAt: '2026-08-19T06:00:00.000Z' });
  const receipts = {
    shipped: makeReceipt({
      planId: 'shipped',
      status: 'landed',
      commits: 4,
      landedAt: '2026-08-20T09:30:00.000Z',
    }),
  };

  const brief = buildMorningBrief([plan], since, until, receipts);
  expect(brief.planCount).toBe(0);
  expect(brief.landedCount).toBe(1);
  expect(brief.closedLoops.map((loop) => loop.plan.id)).toEqual(['shipped']);
  expect(brief.closedLoops[0]?.occurredAt).toBe(Date.parse('2026-08-20T09:30:00.000Z'));
  expect(brief.closedLoops.map(closedLoopEvidenceLabel)).toEqual(['Landed · 4 commits']);
  expect(hasMorningBriefUpdates([plan], since, until, receipts)).toBe(true);
});

test('a plan that landed before the window is not a closed loop', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  const plan = makePlan({ id: 'old-landing', updatedAt: '2026-08-19T06:00:00.000Z' });
  const receipts = {
    'old-landing': makeReceipt({
      planId: 'old-landing',
      status: 'landed',
      commits: 2,
      landedAt: new Date(since).toISOString(),
    }),
  };

  const brief = buildMorningBrief([plan], since, until, receipts);
  expect(brief.closedLoops).toEqual([]);
  expect(brief.landedCount).toBe(0);
  expect(hasMorningBriefUpdates([plan], since, until, receipts)).toBe(false);
});

test('checked task lists close a loop only when no usable receipt says otherwise', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  const done = '- [x] Implement\n- [x] Test';
  const plans = [
    makePlan({ id: 'no-receipt', updatedAt: '2026-08-20T09:00:00.000Z', content: done }),
    makePlan({ id: 'still-open', updatedAt: '2026-08-20T08:00:00.000Z', content: done }),
    makePlan({ id: 'no-repo', updatedAt: '2026-08-20T07:00:00.000Z', content: done }),
  ];
  const receipts = {
    'still-open': makeReceipt({ planId: 'still-open', status: 'in-progress', commits: 1 }),
    'no-repo': makeReceipt({
      planId: 'no-repo',
      status: 'unavailable',
      unavailableReason: 'no-repository',
    }),
  };

  const brief = buildMorningBrief(plans, since, until, receipts);
  expect(brief.closedLoops.map((loop) => loop.plan.id)).toEqual(['no-receipt', 'no-repo']);
  expect(brief.closedLoops.map(closedLoopEvidenceLabel)).toEqual([
    'All 2 steps done',
    'All 2 steps done',
  ]);
});

test('cloud rows find their local receipt through localPlanId', () => {
  const since = Date.parse('2026-08-20T00:00:00.000Z');
  const until = Date.parse('2026-08-20T12:00:00.000Z');
  const cloudRow = makePlan({
    id: 'convex-id',
    localPlanId: 'local-id',
    updatedAt: '2026-08-19T06:00:00.000Z',
  });
  const receipts = {
    'local-id': makeReceipt({
      planId: 'local-id',
      status: 'landed',
      commits: 1,
      landedAt: '2026-08-20T10:00:00.000Z',
    }),
  };

  const brief = buildMorningBrief([cloudRow], since, until, receipts);
  expect(brief.closedLoops.map((loop) => loop.plan.id)).toEqual(['convex-id']);
  expect(brief.closedLoops.map(closedLoopEvidenceLabel)).toEqual(['Landed · 1 commit']);
});

test('mark read waits for the first receipt answer, then allows reading', () => {
  const ready = {
    loading: false,
    error: false,
    markedRead: false,
    receiptsLoading: false,
    caughtUp: false,
  };
  // Marking read now would persist a boundary past landings the brief has not shown yet.
  expect(morningBriefMarkReadState({ ...ready, receiptsLoading: true })).toEqual({
    disabled: true,
    label: 'Checking git history',
  });
  // Even an otherwise empty brief can't be settled until receipts have answered.
  expect(morningBriefMarkReadState({ ...ready, receiptsLoading: true, caughtUp: true })).toEqual({
    disabled: true,
    label: 'Checking git history',
  });
  expect(morningBriefMarkReadState(ready)).toEqual({ disabled: false, label: 'Mark brief read' });
});
