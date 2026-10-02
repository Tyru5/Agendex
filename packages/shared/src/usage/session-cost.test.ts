import { expect, test } from 'bun:test';
import {
  countPlansInSession,
  resolveUsageSession,
  sessionCostFromSnapshots,
  type SessionUsageSnapshot,
} from './session-cost.ts';
import { emptyTokenTotals, type UsageCloudEvent } from './types.ts';

const identity = { agent: 'codex-cli' as const, sessionId: 'thread-1' };
const plan = { agent: 'codex-cli', metadata: { sessionId: 'thread-1' } };
function event(overrides: Partial<UsageCloudEvent> = {}): UsageCloudEvent {
  return {
    key: 'key-1',
    agent: 'codex-cli',
    sessionId: 'thread-1',
    model: 'model',
    timestampMs: Date.now(),
    bucketStart: '2026-09-29',
    totals: { ...emptyTokenTotals(), outputTokens: 50 },
    costUsd: 0.25,
    cacheSavingsUsd: 0,
    unpriced: false,
    ...overrides,
  };
}
function snapshot(
  events: UsageCloudEvent[],
  overrides: Partial<SessionUsageSnapshot> = {},
): SessionUsageSnapshot {
  return {
    days: 90,
    generatedAt: new Date().toISOString(),
    records: events.length,
    events,
    ...overrides,
  };
}

test('only native supported agent IDs can join, never OMP/cursor/parent IDs', () => {
  expect(resolveUsageSession(plan)).toEqual(identity);
  expect(resolveUsageSession({ agent: 'omp', metadata: { sessionId: 'thread-1' } })).toBe(
    'unsupported-agent',
  );
  expect(
    resolveUsageSession({ agent: 'codex-cli', metadata: { parentThreadId: 'thread-1' } }),
  ).toBe('missing-session');
  expect(
    resolveUsageSession({
      agent: 'codex-cli',
      metadata: { sessionId: 'thread-1', sessionIdSource: 'omp' },
    }),
  ).toBe('unverified-session');
});
test('conflicting aliases and guessed Claude filenames are rejected', () => {
  expect(
    resolveUsageSession({ agent: 'codex-cli', metadata: { sessionId: 'a', session_id: 'b' } }),
  ).toBe('ambiguous-session');
  expect(
    resolveUsageSession({
      agent: 'claude-code',
      metadata: { sessionId: 'a', sessionIdOrigin: 'ambiguous' },
    }),
  ).toBe('ambiguous-session');
  expect(
    resolveUsageSession({
      agent: 'claude-code',
      metadata: { sessionId: 'a', sessionIdOrigin: 'filename' },
    }),
  ).toBe('unverified-session');
  expect(resolveUsageSession({ agent: 'claude-code', metadata: { sessionId: 'a' } })).toBe(
    'unverified-session',
  );
  expect(
    resolveUsageSession({
      agent: 'claude-code',
      metadata: { sessionId: 'a', sessionIdOrigin: 'frontmatter' },
    }),
  ).toEqual({ agent: 'claude-code', sessionId: 'a' });
});
test('multiple plans share one whole-session amount without splitting or adding cost', () => {
  const peers = [plan, { ...plan }, { agent: 'grok', metadata: { sessionId: 'thread-1' } }];
  const cost = sessionCostFromSnapshots(
    identity,
    [snapshot([event()])],
    countPlansInSession(peers, identity),
  );
  expect(cost).toMatchObject({
    status: 'available',
    costUsd: 0.25,
    totalTokens: 50,
    records: 1,
    sharedPlanCount: 2,
    currency: 'USD',
    pricing: 'estimated',
  });
});
test('mirrored cloud events dedupe and unrelated sessions/agents do not join', () => {
  const a = snapshot([
    event(),
    event({ key: 'other', sessionId: 'other' }),
    event({ key: 'grok', agent: 'grok' }),
  ]);
  const b = snapshot([event()]);
  expect(sessionCostFromSnapshots(identity, [a, b])).toMatchObject({ costUsd: 0.25, records: 1 });
});
test('v2 ownership IDs reconcile legacy aliases and preserve id-less occurrences', () => {
  const legacy = event({ key: 'legacy', sessionId: 'grok:updates', agent: 'grok' });
  const current = { ...legacy, ownershipKey: 'fingerprint-1', ownershipSessionId: 'grok:folder' };
  const second = { ...current, ownershipKey: 'fingerprint-2' };
  const grokIdentity = {
    agent: 'grok' as const,
    sessionId: 'native-id',
    sessionAliases: ['grok:folder'],
  };
  const cost = sessionCostFromSnapshots(grokIdentity, [
    snapshot([legacy]),
    snapshot([current, second], { cloudFormatVersion: 2 }),
  ]);
  expect(cost).toMatchObject({ records: 2, costUsd: 0.5, sessionId: 'native-id' });
  expect(Object.keys(cost).includes('sessionAliases')).toBe(false);
});
test('missing snapshots, mismatched windows, and truncated aggregates stay unavailable', () => {
  expect(sessionCostFromSnapshots(identity, [])).toMatchObject({
    status: 'unavailable',
    reason: 'usage-unavailable',
    costUsd: null,
  });
  expect(sessionCostFromSnapshots(identity, [snapshot([event()], { days: 30 })]).reason).toBe(
    'usage-unavailable',
  );
  expect(sessionCostFromSnapshots(identity, [snapshot([event()], { records: 2 })])).toMatchObject({
    reason: 'incomplete-snapshot',
    costUsd: null,
  });
  expect(sessionCostFromSnapshots(identity, [snapshot([])]).reason).toBe('no-records');
});
test('unknown prices are not displayed as a zero-dollar session', () => {
  const unknown = event({ costUsd: 0, unpriced: true });
  const cost = sessionCostFromSnapshots(identity, [snapshot([unknown])]);
  expect(cost).toMatchObject({
    status: 'available',
    costUsd: null,
    pricing: 'unpriced',
    totalTokens: 50,
    unpricedRecords: 1,
  });
  expect(cost.models[0]?.costUsd).toBeNull();
  const mixed = sessionCostFromSnapshots(identity, [
    snapshot([event(), { ...unknown, key: 'unknown' }]),
  ]);
  expect(mixed).toMatchObject({
    costUsd: 0.25,
    pricing: 'partial',
    records: 2,
    unpricedRecords: 1,
  });
});
test('a valid zero reported cost is priced, with the observed window disclosed', () => {
  const cost = sessionCostFromSnapshots(identity, [snapshot([event({ costUsd: 0 })])]);
  expect(cost).toMatchObject({ costUsd: 0, pricing: 'estimated', windowDays: 90 });
});

test('stale cloud snapshots exclude old events from the current observed window', () => {
  const now = Date.now();
  const day = 24 * 60 * 60_000;
  const stale = snapshot([event({ key: 'old', timestampMs: now - 170 * day, costUsd: 40 })], {
    generatedAt: new Date(now - 89 * day).toISOString(),
  });
  const current = snapshot([event({ key: 'current', timestampMs: now, costUsd: 1 })]);
  const cost = sessionCostFromSnapshots(identity, [stale, current], null, now);
  expect(cost).toMatchObject({ costUsd: 1, records: 1, windowDays: 90, totalTokens: 50 });
  expect(sessionCostFromSnapshots(identity, [stale], null, now).reason).toBe('no-records');
});
test('current cloud window preserves boundary records and rejects future clock jumps', () => {
  const now = Date.now();
  const since = now - 90 * 24 * 60 * 60_000;
  const cost = sessionCostFromSnapshots(
    identity,
    [
      snapshot([
        event({ key: 'at-boundary', timestampMs: since }),
        event({ key: 'too-old', timestampMs: since - 1 }),
        event({ key: 'clock-tolerance', timestampMs: now + 60_000 }),
        event({ key: 'future', timestampMs: now + 60_001 }),
      ]),
    ],
    null,
    now,
  );
  expect(cost).toMatchObject({ records: 2, costUsd: 0.5 });
});
