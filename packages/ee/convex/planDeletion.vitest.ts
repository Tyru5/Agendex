/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const makeConvex = () => convexTest(schema, modules);
type TestConvex = ReturnType<typeof makeConvex>;

const VERSION_COUNT = 260;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = makeConvex();
  const planId = await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('subscriptions', {
      userId: 'owner',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      status: 'active',
      plan: 'monthly',
      currentPeriodEnd: now + 1_000_000,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });
    const id = await ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'claude',
      title: 'Large history',
      content: '# Plan',
      format: 'markdown',
      version: VERSION_COUNT,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert('shareLinks', {
        planId: id,
        token: `token-${i}`,
        createdBy: 'owner',
        createdAt: now,
      });
    }
    for (let version = 1; version <= VERSION_COUNT; version++) {
      await ctx.db.insert('planVersions', {
        ownerId: 'owner',
        planId: id,
        version,
        title: 'Large history',
        content: `v${version}`,
        format: 'markdown',
        createdAt: now,
      });
    }
    return id;
  });
  return { t, planId };
}

function relatedCounts(t: TestConvex, planId: Id<'plans'>) {
  return t.run(async (ctx) => ({
    plan: await ctx.db.get(planId),
    shareLinks: (
      await ctx.db
        .query('shareLinks')
        .withIndex('by_plan', (q) => q.eq('planId', planId))
        .collect()
    ).length,
    planVersions: (
      await ctx.db
        .query('planVersions')
        .withIndex('by_plan', (q) => q.eq('planId', planId))
        .collect()
    ).length,
  }));
}

test('plan deletion stays bounded and drains large related data in scheduled batches', async () => {
  const { t, planId } = await setup();

  await expect(
    t.mutation(internal.cli.deleteSyncedPlan, { ownerId: 'owner', planId }),
  ).resolves.toBe(true);

  const afterDelete = await relatedCounts(t, planId);
  expect(afterDelete.plan).toBeNull();
  expect(afterDelete.shareLinks).toBe(0);
  expect(afterDelete.planVersions).toBeGreaterThan(0);
  expect(afterDelete.planVersions).toBeLessThan(VERSION_COUNT);

  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await relatedCounts(t, planId)).toEqual({ plan: null, shareLinks: 0, planVersions: 0 });
});

test('the scheduled continuation never strips data from a plan that still exists', async () => {
  const { t, planId } = await setup();

  await t.mutation(internal.planDeletion.continuePlanRelatedDataCleanup, {
    planId,
    phase: 'shareLinks',
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const counts = await relatedCounts(t, planId);
  expect(counts.plan).not.toBeNull();
  expect(counts.shareLinks).toBe(3);
  expect(counts.planVersions).toBe(VERSION_COUNT);
});
