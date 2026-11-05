/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import type { Id } from './_generated/dataModel';
import { recordPlanVersion } from './planVersioning';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

async function setup(lastReadVersion?: number) {
  const t = convexTest(schema, modules);
  const planId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'claude',
      title: 'Busy plan',
      content: 'body',
      format: 'markdown',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (lastReadVersion !== undefined) {
      await ctx.db.insert('planPreferences', {
        ownerId: 'owner',
        planId: id,
        pinned: false,
        createdAt: now,
        updatedAt: now,
        lastReadVersion,
      });
    }
    return id;
  });
  return { t, planId };
}

const snapshot = (n: number) => ({ title: `v${n}`, content: `content ${n}`, format: 'markdown' });

async function versionsOf(t: Awaited<ReturnType<typeof setup>>['t'], planId: Id<'plans'>) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query('planVersions')
        .withIndex('by_plan', (q) => q.eq('planId', planId))
        .collect()
    )
      .map((row) => row.version)
      .sort((a, b) => a - b),
  );
}

test('history keeps the newest 100 versions and the owner read baseline', async () => {
  const { t, planId } = await setup(3);
  for (let version = 1; version <= 105; version++) {
    await t.run((ctx) =>
      recordPlanVersion(ctx, { ownerId: 'owner', planId, version, snapshot: snapshot(version) }),
    );
  }

  const expected = [3, ...Array.from({ length: 100 }, (_, i) => i + 6)];
  expect(await versionsOf(t, planId)).toEqual(expected);
});

test('an existing backlog drains a bounded batch per write', async () => {
  const { t, planId } = await setup();
  // Simulate a plan that grew before retention existed: 120 versions, no pruning.
  await t.run(async (ctx) => {
    for (let version = 1; version <= 120; version++) {
      await ctx.db.insert('planVersions', {
        ownerId: 'owner',
        planId,
        version,
        ...snapshot(version),
        createdAt: version,
      });
    }
  });

  await t.run((ctx) =>
    recordPlanVersion(ctx, { ownerId: 'owner', planId, version: 121, snapshot: snapshot(121) }),
  );
  // Cutoff is 21 (versions 1..21 out of window); one write prunes only the oldest 5.
  const afterOne = await versionsOf(t, planId);
  expect(afterOne[0]).toBe(6);
  expect(afterOne).toHaveLength(116);

  for (let version = 122; version <= 127; version++) {
    await t.run((ctx) =>
      recordPlanVersion(ctx, { ownerId: 'owner', planId, version, snapshot: snapshot(version) }),
    );
  }
  const drained = await versionsOf(t, planId);
  expect(drained).toEqual(Array.from({ length: 100 }, (_, i) => i + 28));
});
