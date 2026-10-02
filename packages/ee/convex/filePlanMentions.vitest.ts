/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { refreshFilePlanMentions } from './filePlanMentionIndex';
import { deletePlanRelatedData, deletePlanRelatedDataBatch } from './planDeletion';

vi.mock('./auth', () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity(): Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject } : null;
    },
    getAuthUser: async (ctx: {
      auth: { getUserIdentity(): Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw new Error('Unauthenticated');
      return { _id: identity.subject };
    },
  },
}));
const modules = import.meta.glob('./**/*.ts');
const content = (files: string[]) =>
  `# Implement authentication\n\n## Steps\n${files.map((path) => `- Update \`${path}\` to reject invalid tokens.`).join('\n')}\n\n## Verification\n- Run bun test for authentication routes.\n\n## Acceptance criteria\n- Invalid tokens return HTTP 401.\n`;
const make = () => convexTest(schema, modules);
afterEach(() => vi.useRealTimers());

async function addPlan(
  t: ReturnType<typeof make>,
  ownerId: string,
  files: string[],
  workspace = '/repo',
  metadata?: Record<string, unknown>,
) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert('plans', {
      ownerId,
      agent: 'claude',
      title: 'Implement authentication',
      content: content(files),
      format: 'markdown',
      workspace,
      metadata,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await refreshFilePlanMentions(ctx, id);
    return id;
  });
}
async function subscribe(t: ReturnType<typeof make>, ownerId: string) {
  return t.run((ctx) =>
    ctx.db.insert('subscriptions', {
      userId: ownerId,
      stripeCustomerId: `cus_${ownerId}`,
      stripeSubscriptionId: `sub_${ownerId}`,
      status: 'active',
      plan: 'monthly',
      currentPeriodEnd: Date.now() + 86400000,
      cancelAtPeriodEnd: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
const lookupArgs = (files: string[], cursor: string | null = null) => ({
  files,
  paginationOpts: { numItems: 1, cursor },
});

test('lookup and counts exclude anonymous, other-owner and classifier-hidden plans', async () => {
  const t = make();
  const own = await addPlan(t, 'owner', ['src/auth.ts']);
  await addPlan(t, 'other', ['src/auth.ts']);
  await addPlan(t, 'owner', ['src/auth.ts'], '/repo', { lowValue: true });
  expect((await t.query(api.filePlanMentions.lookup, lookupArgs(['src/auth.ts']))).page).toEqual(
    [],
  );
  const owner = t.withIdentity({ subject: 'owner' });
  const result = await owner.query(api.filePlanMentions.lookup, lookupArgs(['src/auth.ts']));
  expect(result.page).toEqual([String(own)]);
  expect(await owner.query(api.filePlanMentions.counts, { paths: ['src/auth.ts'] })).toEqual([
    { path: 'src/auth.ts', count: 1, exact: true },
  ]);
});

test('team members inherit only the actively subscribed owner scope', async () => {
  const t = make();
  await subscribe(t, 'owner');
  const teamPlan = await addPlan(t, 'owner', ['src/auth.ts']);
  const personal = await addPlan(t, 'member', ['src/auth.ts']);
  await t.run((ctx) =>
    ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: 'owner',
      memberId: 'member',
      email: 'member@example.com',
      emailLc: 'member@example.com',
      role: 'member',
      addedAt: Date.now(),
    }),
  );
  const member = t.withIdentity({ subject: 'member' });
  expect(
    (await member.query(api.filePlanMentions.lookup, lookupArgs(['src/auth.ts']))).page,
  ).toEqual([String(teamPlan)]);
  await subscribe(t, 'member');
  expect(
    (await member.query(api.filePlanMentions.lookup, lookupArgs(['src/auth.ts']))).page,
  ).toEqual([String(personal)]);
});

test('intersections remain paginated and enforce workspace boundaries', async () => {
  const t = make();
  const both = await addPlan(t, 'owner', ['src/auth.ts', 'src/token.ts']);
  await addPlan(t, 'owner', ['src/auth.ts']);
  await addPlan(t, 'owner', ['src/auth.ts', 'src/token.ts'], '/other');
  const owner = t.withIdentity({ subject: 'owner' });
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const result: {
      page: string[];
      isDone: boolean;
      continueCursor: string;
      indexingComplete: boolean;
    } = await owner.query(api.filePlanMentions.lookup, {
      ...lookupArgs(['src/auth.ts', 'src/token.ts'], cursor),
      workspace: '/repo/',
    });
    ids.push(...result.page);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(ids).toEqual([String(both)]);
  expect(
    (
      await owner.query(api.filePlanMentions.lookup, {
        ...lookupArgs(['/repo-other/src/auth.ts']),
        workspace: '/repo',
      })
    ).page,
  ).toEqual([]);
});

test('upsert, editor update, restore, and deletion keep index rows transactional', async () => {
  const t = make();
  await subscribe(t, 'owner');
  const owner = t.withIdentity({ subject: 'owner' });
  const id = await t.mutation(internal.cli.upsertPlan, {
    ownerId: 'owner',
    localPlanId: 'local1',
    agent: 'claude',
    title: 'Implement authentication',
    content: content(['src/old.ts']),
    format: 'markdown',
    workspace: '/repo',
  });
  expect(
    (await owner.query(api.filePlanMentions.counts, { paths: ['src/old.ts'] }))[0]?.count,
  ).toBe(1);
  await owner.mutation(api.plans.updatePlanContent, {
    planId: id,
    title: 'Implement authentication',
    content: content(['src/new.ts']),
  });
  expect(
    (await owner.query(api.filePlanMentions.counts, { paths: ['src/old.ts', 'src/new.ts'] })).map(
      (row) => row.count,
    ),
  ).toEqual([0, 1]);
  const versions = await t.run((ctx) =>
    ctx.db
      .query('planVersions')
      .withIndex('by_plan', (q) => q.eq('planId', id))
      .collect(),
  );
  const original = versions.find((row) => row.version === 1);
  expect(original).toBeDefined();
  await owner.mutation(api.planVersions.restore, { planId: id, version: 1 });
  expect(
    (await owner.query(api.filePlanMentions.counts, { paths: ['src/old.ts', 'src/new.ts'] })).map(
      (row) => row.count,
    ),
  ).toEqual([1, 0]);
  await owner.mutation(api.plans.deletePlan, { planId: id });
  expect(await t.run((ctx) => ctx.db.query('filePlanMentions').collect())).toEqual([]);
});

test('account deletion drains mention rows in restart-safe per-plan batches', async () => {
  const t = make();
  const id = await addPlan(t, 'owner', ['src/a.ts', 'src/b.ts']);
  await t.run(async (ctx) => {
    const first = await deletePlanRelatedDataBatch(ctx, {
      planId: id,
      phase: 'filePlanMentions',
      batchSize: 1,
    });
    expect(first).toEqual({ deleted: 1, nextPhase: 'filePlanMentions' });
    const second = await deletePlanRelatedDataBatch(ctx, {
      planId: id,
      phase: 'filePlanMentions',
      batchSize: 1,
    });
    expect(second.deleted).toBe(1);
    const drained = await deletePlanRelatedDataBatch(ctx, {
      planId: id,
      phase: 'filePlanMentions',
      batchSize: 1,
    });
    expect(drained.deleted).toBe(0);
    expect(drained.nextPhase).not.toBe('filePlanMentions');
    expect(
      await ctx.db
        .query('filePlanMentions')
        .withIndex('by_plan', (q) => q.eq('planId', id))
        .take(1),
    ).toEqual([]);
  });
});

test('legacy plans signal indexing until scheduled bounded backfill finishes', async () => {
  vi.useFakeTimers();
  const t = make();
  await t.run(async (ctx) => {
    for (let i = 0; i < 6; i++)
      await ctx.db.insert('plans', {
        ownerId: 'owner',
        agent: 'claude',
        title: 'Implement authentication',
        content: content(['src/auth.ts']),
        format: 'markdown',
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
  });
  const owner = t.withIdentity({ subject: 'owner' });
  expect(await owner.query(api.filePlanMentions.indexingStatus, {})).toEqual({ complete: false });
  expect(await t.mutation(internal.filePlanMentions.backfill, {})).toEqual({
    indexed: 3,
    done: false,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await owner.query(api.filePlanMentions.indexingStatus, {})).toEqual({ complete: true });
  expect(
    (await owner.query(api.filePlanMentions.counts, { paths: ['src/auth.ts'] }))[0]?.count,
  ).toBe(6);
});

test('oversized path and page inputs reject before querying the database', async () => {
  const t = make().withIdentity({ subject: 'owner' });
  await expect(
    t.query(api.filePlanMentions.lookup, {
      files: Array(9).fill('src/a.ts'),
      paginationOpts: { numItems: 1, cursor: null },
    }),
  ).rejects.toThrow('between 1 and 8');
  await expect(
    t.query(api.filePlanMentions.lookup, {
      files: ['src/a.ts'],
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow('Page size');
  await expect(
    t.query(api.filePlanMentions.counts, { paths: Array(21).fill('src/a.ts') }),
  ).rejects.toThrow('between 1 and 20');
});

test('publish and identity-only sync moves reindex the unchanged content workspace', async () => {
  const t = make();
  await subscribe(t, 'owner');
  const owner = t.withIdentity({ subject: 'owner' });
  const args = {
    localPlanId: 'published1',
    agent: 'claude',
    title: 'Implement authentication',
    content: content(['src/auth.ts']),
    format: 'markdown',
    workspace: '/repo',
  };
  const id = await owner.mutation(api.plans.publishPlan, args);
  expect(
    (
      await owner.query(api.filePlanMentions.counts, { paths: ['src/auth.ts'], workspace: '/repo' })
    )[0]?.count,
  ).toBe(1);
  expect(await owner.mutation(api.plans.publishPlan, { ...args, workspace: '/moved' })).toBe(id);
  expect(
    (
      await owner.query(api.filePlanMentions.counts, { paths: ['src/auth.ts'], workspace: '/repo' })
    )[0]?.count,
  ).toBe(0);
  expect(
    (
      await owner.query(api.filePlanMentions.counts, {
        paths: ['src/auth.ts'],
        workspace: '/moved',
      })
    )[0]?.count,
  ).toBe(1);
  await t.mutation(internal.cli.patchPlanSyncIdentity, {
    ownerId: 'owner',
    planId: id,
    localPlanId: 'published1',
    workspace: '/final',
  });
  expect(
    (
      await owner.query(api.filePlanMentions.counts, {
        paths: ['src/auth.ts'],
        workspace: '/moved',
      })
    )[0]?.count,
  ).toBe(0);
  expect(
    (
      await owner.query(api.filePlanMentions.counts, {
        paths: ['src/auth.ts'],
        workspace: '/final',
      })
    )[0]?.count,
  ).toBe(1);
});

test('counts cap large matching sets and classify edits hidden immediately', async () => {
  const t = make();
  await subscribe(t, 'owner');
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++) {
      const id = await ctx.db.insert('plans', {
        ownerId: 'owner',
        agent: 'claude',
        title: `Implement authentication ${i}`,
        content: content(['src/auth.ts']),
        format: 'markdown',
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await refreshFilePlanMentions(ctx, id);
    }
  });
  const owner = t.withIdentity({ subject: 'owner' });
  expect(await owner.query(api.filePlanMentions.counts, { paths: ['src/auth.ts'] })).toEqual([
    { path: 'src/auth.ts', count: 100, exact: false },
  ]);
  const single = await addPlan(t, 'owner', ['src/unique.ts']);
  await owner.mutation(api.plans.updatePlanContent, {
    planId: single,
    title: 'Implement authentication',
    content: '# Placeholder\n\nSee `src/unique.ts`.',
  });
  expect(await owner.query(api.filePlanMentions.counts, { paths: ['src/unique.ts'] })).toEqual([
    { path: 'src/unique.ts', count: 0, exact: true },
  ]);
  await expect(
    owner.query(api.filePlanMentions.lookup, lookupArgs(['src/auth.ts'], 'invalid-cursor')),
  ).rejects.toThrow();
});

test('opening the dashboard starts only the readable owner backfill immediately', async () => {
  vi.useFakeTimers();
  const t = make();
  await t.run(async (ctx) => {
    for (const ownerId of ['owner', 'other'])
      for (let i = 0; i < 4; i++)
        await ctx.db.insert('plans', {
          ownerId,
          agent: 'claude',
          title: 'Implement authentication',
          content: content(['src/auth.ts']),
          format: 'markdown',
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
  });
  const owner = t.withIdentity({ subject: 'owner' });
  expect(await owner.mutation(api.filePlanMentions.ensureIndex, {})).toEqual({ scheduled: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await owner.query(api.filePlanMentions.indexingStatus, {})).toEqual({ complete: true });
  expect(
    await t.withIdentity({ subject: 'other' }).query(api.filePlanMentions.indexingStatus, {}),
  ).toEqual({ complete: false });
  expect(await owner.mutation(api.filePlanMentions.ensureIndex, {})).toEqual({ scheduled: false });
});

test('account deletion also removes orphan mention rows scoped to the deleted owner', async () => {
  vi.useFakeTimers();
  const t = make();
  const orphan = await addPlan(t, 'owner', ['src/orphan.ts']);
  await addPlan(t, 'other', ['src/orphan.ts']);
  const jobId = await t.run(async (ctx) => {
    await ctx.db.delete(orphan); // Simulate a legacy interrupted deletion.
    return ctx.db.insert('accountDeletionJobs', {
      ownerId: 'owner',
      status: 'deleting',
      phase: 'filePlanMentions',
      attempt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'owner' });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query('filePlanMentions')
        .withIndex('by_owner', (q) => q.eq('ownerId', 'owner'))
        .collect(),
    ),
  ).toEqual([]);
  expect(
    (
      await t.run((ctx) =>
        ctx.db
          .query('filePlanMentions')
          .withIndex('by_owner', (q) => q.eq('ownerId', 'other'))
          .collect(),
      )
    ).length,
  ).toBe(1);
  await t.run(async (ctx) => {
    for (const scheduled of await ctx.db.system.query('_scheduled_functions').collect())
      await ctx.scheduler.cancel(scheduled._id);
    await ctx.db.delete(jobId);
  });
});

test('duplicate sync identities expose only the listed winner mentions', async () => {
  const t = make();
  const addDuplicate = (files: string[], updatedAt: number) =>
    t.run(async (ctx) => {
      const id = await ctx.db.insert('plans', {
        ownerId: 'owner',
        agent: 'claude',
        title: 'Implement authentication',
        content: content(files),
        format: 'markdown',
        workspace: '/repo',
        syncIdentityKey: 'sync-1',
        version: 1,
        createdAt: updatedAt,
        updatedAt,
      });
      await refreshFilePlanMentions(ctx, id);
      return id;
    });
  const older = await addDuplicate(['src/old.ts', 'src/auth.ts'], 1_000);
  const newer = await addDuplicate(['src/auth.ts'], 2_000);
  const owner = t.withIdentity({ subject: 'owner' });
  const count = async (path: string) =>
    (await owner.query(api.filePlanMentions.counts, { paths: [path] }))[0]?.count;
  expect(await count('src/old.ts')).toBe(0);
  expect(await count('src/auth.ts')).toBe(1);
  expect(
    (await owner.query(api.filePlanMentions.lookup, lookupArgs(['src/auth.ts']))).page,
  ).toEqual([String(newer)]);
  await t.run(async (ctx) => {
    await deletePlanRelatedData(ctx, { planId: newer, ownerId: 'owner' });
    await ctx.db.delete(newer);
  });
  expect(await count('src/old.ts')).toBe(1);
  expect(
    (await owner.query(api.filePlanMentions.lookup, lookupArgs(['src/auth.ts']))).page,
  ).toEqual([String(older)]);
});

test('identity-only republish without metadata keeps stored metadata', async () => {
  const t = make();
  await subscribe(t, 'owner');
  const owner = t.withIdentity({ subject: 'owner' });
  const args = {
    localPlanId: 'published-meta',
    agent: 'claude',
    title: 'Implement authentication',
    content: content(['src/auth.ts']),
    format: 'markdown',
    workspace: '/repo',
    metadata: { source: 'custom', customDir: '/plans' },
  };
  const id = await owner.mutation(api.plans.publishPlan, args);
  const { metadata: _omitted, ...retry } = args;
  await owner.mutation(api.plans.publishPlan, retry);
  const stored = await t.run((ctx) => ctx.db.get(id));
  expect(stored?.metadata).toMatchObject({ source: 'custom', customDir: '/plans' });
  expect(stored?.workspace).toBe('/repo');
});

test('large duplicate groups still expose the newest winner only', async () => {
  const t = make();
  const ids = await t.run(async (ctx) => {
    const created = [];
    for (let i = 0; i < 40; i++) {
      const id = await ctx.db.insert('plans', {
        ownerId: 'owner',
        agent: 'claude',
        title: 'Implement authentication',
        content: content([`src/file${i}.ts`]),
        format: 'markdown',
        workspace: '/repo',
        syncIdentityKey: 'sync-large',
        version: 1,
        createdAt: i,
        updatedAt: i,
      });
      await refreshFilePlanMentions(ctx, id);
      created.push(id);
    }
    return created;
  });
  const owner = t.withIdentity({ subject: 'owner' });
  const counts = await owner.query(api.filePlanMentions.counts, {
    paths: ['src/file0.ts', 'src/file38.ts', 'src/file39.ts'],
  });
  expect(counts.map((count) => count.count)).toEqual([0, 0, 1]);
  const oldest = ids[0];
  if (!oldest) throw new Error('missing plan');
  // Refreshing an old member outside the reconcile window keeps it hidden.
  await t.run((ctx) => refreshFilePlanMentions(ctx, oldest));
  expect(
    (await owner.query(api.filePlanMentions.counts, { paths: ['src/file0.ts'] }))[0]?.count,
  ).toBe(0);
  // Low-value members never join the group, so they cannot shadow the winner.
  await t.run(async (ctx) => {
    for (let i = 0; i < 40; i++) {
      const id = await ctx.db.insert('plans', {
        ownerId: 'owner',
        agent: 'claude',
        title: 'Implement authentication',
        content: content([`src/low${i}.ts`]),
        format: 'markdown',
        workspace: '/repo',
        syncIdentityKey: 'sync-large',
        metadata: { lowValue: true },
        version: 1,
        createdAt: 500 + i,
        updatedAt: 500 + i,
      });
      await refreshFilePlanMentions(ctx, id);
    }
  });
  expect(
    (await owner.query(api.filePlanMentions.counts, { paths: ['src/file39.ts'] }))[0]?.count,
  ).toBe(1);
  await t.run(async (ctx) => {
    await ctx.db.patch(oldest, { updatedAt: 1_000 });
    await refreshFilePlanMentions(ctx, oldest);
  });
  const moved = await owner.query(api.filePlanMentions.counts, {
    paths: ['src/file0.ts', 'src/file39.ts'],
  });
  expect(moved.map((count) => count.count)).toEqual([1, 0]);
});

test('plans indexed by an older version are reindexed and stale low-value keys never win', async () => {
  vi.useFakeTimers();
  const t = make();
  const [useful, stale] = await t.run(async (ctx) => {
    const base = {
      ownerId: 'owner',
      agent: 'claude',
      title: 'Implement authentication',
      format: 'markdown',
      workspace: '/repo',
      syncIdentityKey: 'sync-stale',
      version: 1,
    };
    const usefulId = await ctx.db.insert('plans', {
      ...base,
      content: content(['src/auth.ts']),
      createdAt: 1,
      updatedAt: 1,
    });
    await refreshFilePlanMentions(ctx, usefulId);
    // Simulates a v1-indexed low-value plan that still carries a group key.
    const staleId = await ctx.db.insert('plans', {
      ...base,
      content: content(['src/other.ts']),
      metadata: { lowValue: true },
      fileMentionIndexVersion: 1,
      fileMentionDuplicateKey: 'sync:sync-stale',
      createdAt: 2,
      updatedAt: 2,
    });
    return [usefulId, staleId];
  });
  const owner = t.withIdentity({ subject: 'owner' });
  expect(await owner.query(api.filePlanMentions.indexingStatus, {})).toEqual({ complete: false });
  await t.run((ctx) => refreshFilePlanMentions(ctx, useful));
  expect(
    (await owner.query(api.filePlanMentions.counts, { paths: ['src/auth.ts'] }))[0]?.count,
  ).toBe(1);
  await t.mutation(internal.filePlanMentions.backfill, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await owner.query(api.filePlanMentions.indexingStatus, {})).toEqual({ complete: true });
  const healed = await t.run((ctx) => ctx.db.get(stale));
  expect(healed?.fileMentionIndexVersion).toBe(2);
  expect(healed?.fileMentionDuplicateKey).toBeUndefined();
});
