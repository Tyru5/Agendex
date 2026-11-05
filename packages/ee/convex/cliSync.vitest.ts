/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import {
  MAX_SYNC_CONTENT_BYTES,
  MAX_SYNC_METADATA_BYTES,
  MAX_SYNC_TITLE_LENGTH,
  cliSyncPayloadSizeError,
} from './cli';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

async function subscribedT() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
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
  });
  return t;
}

test('concurrent first syncs of one local plan converge on a single row', async () => {
  const t = await subscribedT();
  const base = {
    ownerId: 'owner',
    localPlanId: 'local-1',
    agent: 'claude',
    format: 'markdown',
  };

  // Both requests looked up "no existing plan" before either mutation ran.
  const first = await t.mutation(internal.cli.upsertPlan, {
    ...base,
    title: 'Plan',
    content: '# First',
  });
  const second = await t.mutation(internal.cli.upsertPlan, {
    ...base,
    title: 'Plan',
    content: '# Second',
  });

  expect(second).toBe(first);
  const plans = await t.run((ctx) =>
    ctx.db
      .query('plans')
      .withIndex('by_owner_localPlanId', (q) =>
        q.eq('ownerId', 'owner').eq('localPlanId', 'local-1'),
      )
      .collect(),
  );
  expect(plans).toHaveLength(1);
  expect(plans[0]).toMatchObject({ content: '# Second', version: 2 });
});

test('sync payload size limits measure bytes and name the offending field', () => {
  expect(cliSyncPayloadSizeError({ title: 'ok', content: '# ok', metadata: { a: 1 } })).toBeNull();
  expect(
    cliSyncPayloadSizeError({ title: 'ok', content: 'a'.repeat(MAX_SYNC_CONTENT_BYTES) }),
  ).toBeNull();

  // 3-byte UTF-8 characters: under the limit in UTF-16 length, over it in bytes.
  const multibyte = '€'.repeat(Math.ceil(MAX_SYNC_CONTENT_BYTES / 3) + 1);
  expect(multibyte.length).toBeLessThan(MAX_SYNC_CONTENT_BYTES);
  expect(cliSyncPayloadSizeError({ title: 'ok', content: multibyte })).toMatchObject({
    field: 'content',
  });

  expect(
    cliSyncPayloadSizeError({ title: 'x'.repeat(MAX_SYNC_TITLE_LENGTH + 1), content: '' }),
  ).toMatchObject({ field: 'title' });

  expect(
    cliSyncPayloadSizeError({
      title: 'ok',
      content: '',
      metadata: { blob: 'x'.repeat(MAX_SYNC_METADATA_BYTES) },
    }),
  ).toMatchObject({ field: 'metadata' });
});
