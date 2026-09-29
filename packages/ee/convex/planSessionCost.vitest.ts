/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { emptyTokenTotals } from '../../shared/src/usage/types.ts';
const user = vi.hoisted(() => ({ id: 'owner' as string | null }));
vi.mock('./auth', () => ({
  authComponent: { safeGetAuthUser: async () => (user.id ? { _id: user.id } : null) },
}));
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => {
  user.id = 'owner';
});
function snapshot(records = 1) {
  const totals = { ...emptyTokenTotals(), outputTokens: 10 };
  return {
    generatedAt: new Date().toISOString(),
    days: 90,
    resolution: 'day',
    buckets: [],
    totals,
    totalTokens: 10,
    costUsd: 0.5,
    cacheSavingsUsd: 0,
    records,
    unpricedRecords: 0,
    sessions: 1,
    agents: [],
    models: [],
    sources: [],
    scanDurationMs: 0,
    events: [
      {
        key: 'record-1',
        agent: 'codex-cli',
        sessionId: 'thread-a',
        model: 'model',
        timestampMs: Date.now(),
        bucketStart: '2026-09-29',
        totals,
        costUsd: 0.5,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  };
}
async function setup() {
  const t = convexTest(schema, modules);
  const planId = await t.run((ctx) =>
    ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'codex-cli',
      title: 'Implement caching',
      content:
        '# Implement caching\n\n## Steps\n1. Add a cache to src/cache.ts.\n2. Verify hits reuse previous responses.\n\n## Verification\n- Run cache tests.',
      format: 'jsonl',
      metadata: { sessionId: 'thread-a' },
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'owner',
      lastSeenAt: Date.now(),
      deviceId: 'one',
      usageSnapshots: { '90': snapshot() },
    });
    await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'owner',
      lastSeenAt: Date.now(),
      deviceId: 'mirror',
      usageSnapshots: { '90': snapshot() },
    });
    await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'other',
      lastSeenAt: Date.now(),
      usageSnapshots: {
        '90': {
          ...snapshot(),
          events: [{ ...snapshot().events[0], key: 'other-user', costUsd: 999 }],
        },
      },
    });
  });
  return { t, planId };
}
test('owner joins native session events once across devices and excludes other accounts', async () => {
  const { t, planId } = await setup();
  expect(await t.query(api.planSessionCost.get, { planId })).toMatchObject({
    status: 'available',
    costUsd: 0.5,
    records: 1,
    windowDays: 90,
    sharedPlanCount: null,
  });
});
test('unauthenticated and other users cannot read private session spend', async () => {
  const { t, planId } = await setup();
  user.id = null;
  expect(await t.query(api.planSessionCost.get, { planId })).toBeNull();
  user.id = 'other';
  expect(await t.query(api.planSessionCost.get, { planId })).toBeNull();
});
test('truncated owner snapshots do not fabricate a session amount', async () => {
  const { t, planId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'owner',
      lastSeenAt: Date.now(),
      usageSnapshots: { '90': snapshot(2) },
    });
  });
  expect(await t.query(api.planSessionCost.get, { planId })).toMatchObject({
    status: 'unavailable',
    reason: 'incomplete-snapshot',
    costUsd: null,
  });
});
test('hidden plans stay inaccessible and oversized device accounts are bounded', async () => {
  const { t, planId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.patch(planId, { metadata: { sessionId: 'thread-a', lowValue: true } });
  });
  expect(await t.query(api.planSessionCost.get, { planId })).toBeNull();
  await t.run(async (ctx) => {
    await ctx.db.patch(planId, { metadata: { sessionId: 'thread-a' } });
    for (let i = 0; i < 7; i++)
      await ctx.db.insert('daemonHeartbeats', {
        ownerId: 'owner',
        lastSeenAt: Date.now(),
        usageSnapshots: { '90': snapshot() },
      });
  });
  expect(await t.query(api.planSessionCost.get, { planId })).toMatchObject({
    reason: 'incomplete-snapshot',
  });
});

test('offline device events outside the current90-day window are excluded', async () => {
  const { t, planId } = await setup();
  const now = Date.now();
  const day = 24 * 60 * 60_000;
  await t.run(async (ctx) => {
    const older = snapshot();
    older.generatedAt = new Date(now - 89 * day).toISOString();
    older.costUsd = 40;
    older.events[0].key = 'offline-old-event';
    older.events[0].costUsd = 40;
    older.events[0].timestampMs = now - 170 * day;
    await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'owner',
      lastSeenAt: now - 89 * day,
      usageSnapshots: { '90': older },
    });
  });
  expect(await t.query(api.planSessionCost.get, { planId })).toMatchObject({
    status: 'available',
    records: 1,
    costUsd: 0.5,
  });
});
