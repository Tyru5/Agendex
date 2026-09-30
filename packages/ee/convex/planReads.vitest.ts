/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
vi.mock('./auth', () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject } : null;
    },
  },
}));
const modules = import.meta.glob('./**/*.ts');
async function setup() {
  const t = convexTest(schema, modules);
  const planId = await t.run((ctx) =>
    ctx.db.insert('plans', {
      ownerId: 'alice',
      agent: 'omp',
      title: 'Plan',
      content: 'Original',
      format: 'markdown',
      version: 1,
      createdAt: 1000,
      updatedAt: 1000,
    }),
  );
  const owner = t.withIdentity({ subject: 'alice' });
  const open = (content = 'Original', updatedAt = 1000) =>
    owner.mutation(api.planReads.open, { planId, title: 'Plan', content, updatedAt });
  return { t, planId, owner, open };
}
test('first read, exact historical version, and metadata-only updates', async () => {
  const { t, planId, open } = await setup();
  expect(await open()).toEqual({ baseline: null, reason: 'first-read' });
  await t.run((ctx) => ctx.db.patch(planId, { content: 'Updated', version: 2, updatedAt: 2000 }));
  expect(await open('Updated', 2000)).toMatchObject({
    baseline: { content: 'Original' },
    reason: 'available',
  });
  await t.run((ctx) => ctx.db.patch(planId, { updatedAt: 3000 }));
  expect(await open('Updated', 3000)).toMatchObject({ baseline: { content: 'Updated' } });
});
test('stale content and unloaded bodies never advance the boundary', async () => {
  const { t, planId, open } = await setup();
  await expect(open('', 1000)).rejects.toThrow(/stale/);
  await open();
  await t.run((ctx) => ctx.db.patch(planId, { content: 'Updated', version: 2, updatedAt: 2000 }));
  await expect(open('Original', 1000)).rejects.toThrow(/stale/);
  expect(await open('Updated', 2000)).toMatchObject({ baseline: { content: 'Original' } });
});
test('ownership checks isolate accounts and missing plans', async () => {
  const { t, planId } = await setup();
  await expect(
    t.withIdentity({ subject: 'bob' }).mutation(api.planReads.open, {
      planId,
      title: 'Plan',
      content: 'Original',
      updatedAt: 1000,
    }),
  ).rejects.toThrow(/Plan not found/);
  await expect(t.mutation(api.planReads.clear, { planId })).rejects.toThrow(/Unauthenticated/);
  await t.run((ctx) => ctx.db.delete(planId));
  await expect(
    t.withIdentity({ subject: 'alice' }).mutation(api.planReads.clear, { planId }),
  ).rejects.toThrow(/Plan not found/);
});
test('deleted history yields an explicit unavailable baseline and next read recovers', async () => {
  const { t, planId, open } = await setup();
  await open();
  await t.run(async (ctx) => {
    const snapshot = await ctx.db
      .query('planVersions')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .first();
    if (snapshot) await ctx.db.delete(snapshot._id);
  });
  expect(await open()).toEqual({ baseline: null, reason: 'unavailable' });
  expect(await open()).toMatchObject({ reason: 'available', baseline: { content: 'Original' } });
});
test('unread controls and mark-all-read preserve the actual read snapshot', async () => {
  const { t, planId, owner, open } = await setup();
  await open();
  await owner.mutation(api.planPreferences.setPinned, { planId, pinned: false });
  await owner.mutation(api.planPreferences.markUnseen, { planId });
  await t.run((ctx) => ctx.db.patch(planId, { content: 'Updated', version: 2, updatedAt: 2000 }));
  await owner.mutation(api.planPreferences.markManySeen, { planIds: [planId] });
  expect(await open('Updated', 2000)).toMatchObject({ baseline: { content: 'Original' } });
  await owner.mutation(api.planReads.clear, { planId });
  expect(await open('Updated', 2000)).toEqual({ baseline: null, reason: 'first-read' });
});

test('bulk unread timestamps never fabricate a previous opened revision', async () => {
  const { planId, owner, open } = await setup();
  await owner.mutation(api.planPreferences.markManySeen, { planIds: [planId] });
  expect(await open()).toEqual({ baseline: null, reason: 'first-read' });
});
test('oversized cloud plans explicitly clear stale read pointers', async () => {
  const { t, planId, open } = await setup();
  await open();
  const large = 'x'.repeat(256 * 1024);
  await t.run((ctx) => ctx.db.patch(planId, { content: large, version: 2, updatedAt: 2000 }));
  expect(await open(large, 2000)).toEqual({ baseline: null, reason: 'too-large' });
  await t.run((ctx) => ctx.db.patch(planId, { content: 'Smaller', version: 3, updatedAt: 3000 }));
  expect(await open('Smaller', 3000)).toEqual({ baseline: null, reason: 'first-read' });
});

test('real title-only rename creates a distinct baseline, then stops reporting the old title', async () => {
  const { t, planId, owner, open } = await setup();
  await t.run((ctx) =>
    ctx.db.insert('subscriptions', {
      userId: 'alice',
      stripeCustomerId: 'cus_read',
      stripeSubscriptionId: 'sub_read',
      status: 'active',
      plan: 'monthly',
      currentPeriodEnd: Date.now() + 86400000,
      cancelAtPeriodEnd: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await open();
  await owner.mutation(api.plans.renamePlan, { planId, title: 'Renamed plan' });
  const current = await t.run((ctx) => ctx.db.get(planId));
  if (!current) throw new Error('Expected renamed plan');
  expect(current.version).toBe(2);
  const read = () =>
    owner.mutation(api.planReads.open, {
      planId,
      title: current.title,
      content: current.content,
      updatedAt: current.updatedAt,
    });
  expect(await read()).toMatchObject({ baseline: { title: 'Plan', content: 'Original' } });
  expect(await read()).toMatchObject({ baseline: { title: 'Renamed plan', content: 'Original' } });
  await owner.mutation(api.plans.renamePlan, { planId, title: '  Renamed plan  ' });
  expect((await t.run((ctx) => ctx.db.get(planId)))?.version).toBe(2);
  await expect(owner.mutation(api.plans.renamePlan, { planId, title: '   ' })).rejects.toThrow(
    /Title cannot be empty/,
  );
  expect((await t.run((ctx) => ctx.db.get(planId)))?.version).toBe(2);
});

test('legacy same-version renames remember exact live content with or without a prior read', async () => {
  for (const hadRead of [false, true]) {
    const { t, planId, owner, open } = await setup();
    await open();
    if (!hadRead) await owner.mutation(api.planReads.clear, { planId });
    await t.run((ctx) => ctx.db.patch(planId, { title: 'Legacy rename', updatedAt: 2000 }));
    const read = () =>
      owner.mutation(api.planReads.open, {
        planId,
        title: 'Legacy rename',
        content: 'Original',
        updatedAt: 2000,
      });
    expect((await read()).baseline?.title ?? null).toBe(hadRead ? 'Plan' : null);
    expect(await read()).toMatchObject({
      baseline: { title: 'Legacy rename', content: 'Original' },
    });
    expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({ version: 2, updatedAt: 2000 });
    const versions = await t.run((ctx) =>
      ctx.db
        .query('planVersions')
        .withIndex('by_plan_version', (q) => q.eq('planId', planId))
        .collect(),
    );
    expect(versions.map((row) => [row.version, row.title])).toEqual([
      [1, 'Plan'],
      [2, 'Legacy rename'],
    ]);
  }
});
test('legacy repair preserves future snapshots and uses a fresh version counter', async () => {
  const { t, planId, owner, open } = await setup();
  await open();
  await t.run(async (ctx) => {
    await ctx.db.insert('planVersions', {
      ownerId: 'alice',
      planId,
      title: 'Existing future',
      content: 'Future content',
      format: 'markdown',
      version: 2,
      createdAt: 1500,
    });
    await ctx.db.patch(planId, { title: 'Legacy rename', updatedAt: 2000 });
  });
  const read = () =>
    owner.mutation(api.planReads.open, {
      planId,
      title: 'Legacy rename',
      content: 'Original',
      updatedAt: 2000,
    });
  await read();
  expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({ version: 3, updatedAt: 2000 });
  expect(await read()).toMatchObject({ baseline: { title: 'Legacy rename' } });
  const future = await t.run((ctx) =>
    ctx.db
      .query('planVersions')
      .withIndex('by_plan_version', (q) => q.eq('planId', planId).eq('version', 2))
      .first(),
  );
  expect(future?.title).toBe('Existing future');
});

test('baseline revision time remains separate from when it was read', async () => {
  const { t, planId, open } = await setup();
  await open();
  await t.run((ctx) => ctx.db.patch(planId, { content: 'Updated', version: 2, updatedAt: 2000 }));
  expect(await open('Updated', 2000)).toMatchObject({
    baseline: { updatedAt: new Date(1000).toISOString() },
  });
  await t.run((ctx) => ctx.db.patch(planId, { updatedAt: 3000 }));
  await open('Updated', 3000);
  expect(await open('Updated', 3000)).toMatchObject({
    baseline: { updatedAt: new Date(3000).toISOString() },
  });
});

test('CLI sync after a rename uses the live version even with a stale caller counter', async () => {
  const { t, planId, owner, open } = await setup();
  await t.run((ctx) =>
    ctx.db.insert('subscriptions', {
      userId: 'alice',
      stripeCustomerId: 'cus_concurrent',
      stripeSubscriptionId: 'sub_concurrent',
      status: 'active',
      plan: 'monthly',
      currentPeriodEnd: Date.now() + 86400000,
      cancelAtPeriodEnd: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await open();
  await owner.mutation(api.plans.renamePlan, { planId, title: 'Renamed plan' });
  await t.mutation(internal.cli.upsertPlan, {
    ownerId: 'alice',
    localPlanId: 'local-plan',
    agent: 'omp',
    title: 'Synced title',
    content: 'Synced body',
    format: 'markdown',
    existingId: planId,
    existingVersion: 1,
    updatedAt: 4000,
  });
  expect((await t.run((ctx) => ctx.db.get(planId)))?.version).toBe(3);
  const versions = await t.run((ctx) =>
    ctx.db
      .query('planVersions')
      .withIndex('by_plan_version', (q) => q.eq('planId', planId))
      .collect(),
  );
  expect(versions.map((row) => [row.version, row.title, row.content])).toEqual([
    [1, 'Plan', 'Original'],
    [2, 'Renamed plan', 'Original'],
    [3, 'Synced title', 'Synced body'],
  ]);
});
