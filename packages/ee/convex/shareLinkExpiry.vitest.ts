/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND = /Invalid or revoked share link/;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const planId = await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('subscriptions', {
      userId: 'owner',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      status: 'active',
      plan: 'monthly',
      currentPeriodEnd: now + 365 * DAY_MS,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'claude',
      title: 'Expiring share',
      content: '# Plan\n\nBody',
      format: 'markdown',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  });
  const resolve = (token: string) =>
    t.query(internal.sharing.getShareLinkAndPlanInternal, { token });
  return { t, planId, resolve };
}

test('scheduled expiry deletes a 1-day link, making it identical to a revoked link', async () => {
  const { t, planId, resolve } = await setup();
  await t.mutation(internal.sharing.createShareLinkInternal, {
    planId,
    token: 'day-token',
    createdBy: 'owner',
    expiresIn: '1d',
  });

  vi.advanceTimersByTime(DAY_MS - 1000);
  await expect(resolve('day-token')).resolves.toMatchObject({ plan: { title: 'Expiring share' } });

  vi.advanceTimersByTime(2000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await t.run((ctx) => ctx.db.query('shareLinks').collect())).toEqual([]);
  await expect(resolve('day-token')).rejects.toThrow(NOT_FOUND);
  await expect(resolve('never-existed')).rejects.toThrow(NOT_FOUND);
});

test('a link past expiresAt is rejected even before the scheduled deletion runs', async () => {
  const { t, planId, resolve } = await setup();
  const shareLinkId = await t.run(async (ctx) =>
    ctx.db.insert('shareLinks', {
      planId,
      token: 'stale-token',
      createdBy: 'owner',
      createdAt: Date.now() - 2 * DAY_MS,
      expiresAt: Date.now() - 1,
      passwordHash: 'hash',
    }),
  );

  await expect(resolve('stale-token')).rejects.toThrow(NOT_FOUND);
  await expect(
    t.mutation(internal.sharing.issueShareAccessProofInternal, { shareLinkId }),
  ).rejects.toThrow(NOT_FOUND);
});

test('links without expiry keep resolving and schedule nothing', async () => {
  const { t, planId, resolve } = await setup();
  await t.mutation(internal.sharing.createShareLinkInternal, {
    planId,
    token: 'forever-token',
    createdBy: 'owner',
  });

  const [link] = await t.run((ctx) => ctx.db.query('shareLinks').collect());
  expect(link?.expiresAt).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toEqual([]);

  vi.advanceTimersByTime(365 * DAY_MS);
  await expect(resolve('forever-token')).resolves.toMatchObject({
    plan: { title: 'Expiring share' },
  });
});

test('an expiry outside the fixed choices is rejected', async () => {
  const { t, planId } = await setup();
  await expect(
    t.mutation(internal.sharing.createShareLinkInternal, {
      planId,
      token: 'bad-token',
      createdBy: 'owner',
      // @ts-expect-error runtime validation rejects arbitrary durations
      expiresIn: '90d',
    }),
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.query('shareLinks').collect())).toEqual([]);
});
