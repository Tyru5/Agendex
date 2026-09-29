import { expect, test } from 'bun:test';
import type { Plan } from '../types.ts';
import { emptyTokenTotals, type UsageSummary } from '../usage/types.ts';
import { getPlanSessionCost } from './plan-session-cost.ts';
const plan: Plan = {
  id: 'a',
  agent: 'codex-cli',
  title: 'Plan',
  content: '',
  format: 'jsonl',
  filePath: '/rollout.jsonl',
  createdAt: new Date(),
  updatedAt: new Date(),
  metadata: { sessionId: 'thread-a' },
};
const summary: UsageSummary = {
  generatedAt: new Date().toISOString(),
  days: 90,
  resolution: 'day',
  buckets: [],
  totals: { ...emptyTokenTotals(), outputTokens: 500 },
  totalTokens: 500,
  costUsd: 1,
  cacheSavingsUsd: 0,
  records: 500,
  unpricedRecords: 0,
  sessions: 1,
  agents: [],
  models: [],
  sources: [],
  scanDurationMs: 0,
};

test('filters native identity before scanning and uses full totals even above event cap', async () => {
  let requested: unknown;
  const cost = await getPlanSessionCost(plan, [plan, { ...plan, id: 'b' }], async (identity) => {
    requested = identity;
    return summary;
  });
  expect(requested).toEqual({ agent: 'codex-cli', sessionId: 'thread-a' });
  expect(cost).toMatchObject({ records: 500, costUsd: 1, sharedPlanCount: 2 });
});
test('unverified identities never invoke usage scanning', async () => {
  let scans = 0;
  const cost = await getPlanSessionCost({ ...plan, metadata: {} }, [plan], async () => {
    scans++;
    return summary;
  });
  expect(cost.reason).toBe('missing-session');
  expect(scans).toBe(0);
});
test('unreadable sources or scanner failure return unavailable without guessed totals', async () => {
  const cost = await getPlanSessionCost(plan, [plan], async () => ({
    ...summary,
    sources: [{ agent: 'codex-cli', path: '/missing', status: 'missing', files: 0 }],
  }));
  expect(cost).toMatchObject({ status: 'unavailable', reason: 'usage-unavailable', costUsd: null });
  expect(
    (
      await getPlanSessionCost(plan, [plan], async () => {
        throw new Error('unreadable');
      })
    ).reason,
  ).toBe('usage-unavailable');
});
