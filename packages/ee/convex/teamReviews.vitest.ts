/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { authComponent } from './auth';
import schema from './schema';
import type { Doc } from './_generated/dataModel';
import { reviewRevision } from './teamReviews';
import { deletePlanRelatedDataBatch } from './planDeletion';

const modules = import.meta.glob('./**/*.ts');
const paginationOpts = { cursor: null, numItems: 20 };
const content =
  '# Authentication implementation plan\n\n## Implementation\n1. Update src/auth.ts to validate sessions before rendering the dashboard.\n2. Add stale session handling in src/router.ts and preserve the existing login redirect.\n3. Write regression coverage for workspace authorization and denied requests.\n\n## Verification\nRun bun test and confirm an expired session redirects to login without displaying private workspace data.\n\n## Acceptance criteria\nAuthenticated members can read their workspace plans and unrelated users receive an access error.';
type User = NonNullable<Awaited<ReturnType<typeof authComponent.safeGetAuthUser>>>;
function asUser(id: string | null) {
  vi.spyOn(authComponent, 'safeGetAuthUser').mockResolvedValue(
    id ? ({ _id: id } as User) : undefined,
  );
  if (id) vi.spyOn(authComponent, 'getAuthUser').mockResolvedValue({ _id: id } as User);
  else vi.spyOn(authComponent, 'getAuthUser').mockRejectedValue(new Error('Unauthenticated'));
}
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const t = convexTest(schema, modules);
  const seed = await t.run(async (ctx) => {
    const now = Date.now();
    const subscriptionSeed = ctx.db.insert('subscriptions', {
      userId: 'owner',
      stripeCustomerId: 'cus',
      stripeSubscriptionId: 'sub',
      status: 'active',
      plan: 'monthly',
      currentPeriodEnd: now + 100000,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });
    const membershipSeed = ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: 'owner',
      memberId: 'alice',
      email: 'alice@example.com',
      emailLc: 'alice@example.com',
      role: 'member',
      addedAt: now,
    });
    const bobSeed = ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: 'owner',
      memberId: 'bob',
      email: 'bob@example.com',
      emailLc: 'bob@example.com',
      role: 'member',
      addedAt: now,
    });
    const foreignSeed = ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: 'elsewhere',
      memberId: 'foreign',
      email: 'foreign@example.com',
      emailLc: 'foreign@example.com',
      role: 'member',
      addedAt: now,
    });
    const planSeed = ctx.db.insert('plans', {
      ownerId: 'owner',
      localPlanId: 'team-review-fixture',
      agent: 'claude',
      title: 'Authentication implementation',
      content,
      format: 'markdown',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const [subscriptionId, membershipId, planId] = await Promise.all([
      subscriptionSeed,
      membershipSeed,
      planSeed,
      bobSeed,
      foreignSeed,
    ]);
    return { planId, membershipId, subscriptionId };
  });
  asUser('owner');
  const request = (reviewerIds = ['alice']) =>
    t.mutation(api.teamReviews.request, {
      planId: seed.planId,
      reviewerIds,
      message: 'Please check workspace authorization.',
    });
  return { t, ...seed, request };
}

test('owner assigns workspace reviewers and each participant gets only their own authorized queue', async () => {
  const { t, request, planId } = await setup();
  const ids = await request(['alice', 'bob']);
  expect(ids).toHaveLength(2);
  expect(await request(['alice', 'bob'])).toEqual(ids);
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'sent', paginationOpts })).page,
  ).toHaveLength(2);
  asUser('alice');
  const inbox = await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts });
  expect(inbox.page).toHaveLength(1);
  expect(inbox.page[0]).toMatchObject({
    planId,
    status: 'pending',
    unread: true,
    canDecide: true,
    canCancel: false,
  });
  expect((await t.query(api.teamReviews.forPlan, { planId, paginationOpts })).page).toHaveLength(2);
  asUser('foreign');
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts })).page,
  ).toEqual([]);
  expect((await t.query(api.teamReviews.forPlan, { planId, paginationOpts })).page).toEqual([]);
});

test('invalid or repeated reviewer selections reject atomically without creating requests', async () => {
  const { t, request } = await setup();
  for (const ids of [
    [],
    ['owner'],
    ['alice', 'foreign'],
    ['alice', 'alice'],
    Array(11).fill('alice'),
  ]) {
    await expect(request(ids)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query('planReviewRequests').take(20))).toEqual([]);
  }
  asUser('alice');
  await expect(request(['bob'])).rejects.toThrow('Only the plan owner');
  asUser(null);
  await expect(request()).rejects.toThrow('Unauthenticated');
});

test('only the assigned reviewer can decide; changes require a note; duplicate request cannot reset an approval', async () => {
  const { t, request } = await setup();
  const [id] = await request();
  asUser('bob');
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('Review request not found');
  asUser('owner');
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('Review request not found');
  asUser('alice');
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'changes_requested', note: ' ' }),
  ).rejects.toThrow('requires a note');
  await t.mutation(api.teamReviews.decide, {
    requestId: id,
    decision: 'approved',
    note: 'Authorization tests look good.',
  });
  await expect(
    t.mutation(api.teamReviews.decide, {
      requestId: id,
      decision: 'changes_requested',
      note: 'changed my mind',
    }),
  ).rejects.toThrow('no longer pending');
  asUser('owner');
  expect(await request()).toEqual([id]);
  const sent = (await t.query(api.teamReviews.inbox, { direction: 'sent', paginationOpts }))
    .page[0];
  expect(sent).toMatchObject({
    status: 'approved',
    unread: true,
    decisionNote: 'Authorization tests look good.',
    canDecide: false,
  });
  await t.mutation(api.teamReviews.markRead, { requestId: id });
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'sent', paginationOpts })).page[0].unread,
  ).toBe(false);
});

test('a new version invalidates decisions even when reverting to identical content', async () => {
  const { t, request, planId } = await setup();
  const [id] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' });
  await t.run((ctx) => ctx.db.patch(planId, { version: 3, content, updatedAt: Date.now() + 100 }));
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts })).page[0]
      .status,
  ).toBe('superseded');
  asUser('owner');
  const [newId] = await request();
  expect(newId).not.toBe(id);
  asUser('alice');
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('no longer pending');
  await t.mutation(api.teamReviews.decide, {
    requestId: newId,
    decision: 'changes_requested',
    note: 'Add the missing expiry test.',
  });
});

test('exact content changes invalidate pending requests even if a write path forgot to bump version', async () => {
  const { t, request, planId } = await setup();
  const [id] = await request();
  await t.run((ctx) =>
    ctx.db.patch(planId, { content: content + '\n', updatedAt: Date.now() + 10 }),
  );
  asUser('alice');
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts })).page[0]
      .status,
  ).toBe('superseded');
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('no longer pending');
});

test('removed reviewers lose access and rejoining cannot revive their old assignment', async () => {
  const { t, request, planId, membershipId } = await setup();
  const [id] = await request();
  await t.run((ctx) => ctx.db.delete(membershipId));
  asUser('alice');
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts })).page,
  ).toEqual([]);
  await expect(t.mutation(api.teamReviews.markRead, { requestId: id })).rejects.toThrow(
    'Review request not found',
  );
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('Access denied');
  asUser('owner');
  expect((await t.query(api.teamReviews.forPlan, { planId, paginationOpts })).page[0].status).toBe(
    'cancelled',
  );
  await t.run((ctx) =>
    ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: 'owner',
      memberId: 'alice',
      email: 'alice@example.com',
      emailLc: 'alice@example.com',
      role: 'member',
      addedAt: Date.now(),
    }),
  );
  asUser('alice');
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('no longer pending');
  asUser('owner');
  expect((await request())[0]).not.toBe(id);
});

test('owner cancellation notifies reviewer, is final, and allows a fresh request', async () => {
  const { t, request } = await setup();
  const [id] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.markRead, { requestId: id });
  await expect(t.mutation(api.teamReviews.cancel, { requestId: id })).rejects.toThrow(
    'Review request not found',
  );
  asUser('owner');
  await t.mutation(api.teamReviews.cancel, { requestId: id });
  expect((await request())[0]).not.toBe(id);
  asUser('alice');
  const inbox = (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts }))
    .page;
  expect(inbox.find((r) => r.id === id)).toMatchObject({ status: 'cancelled', canDecide: false });
});

test('hidden/deleted plans and an inactive subscription revoke request access', async () => {
  const { t, request, planId, subscriptionId } = await setup();
  const [id] = await request();
  await t.run((ctx) => ctx.db.patch(subscriptionId, { status: 'canceled' }));
  asUser('alice');
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts })).page,
  ).toEqual([]);
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('Workspace subscription required');
  await t.run(async (ctx) => {
    await ctx.db.patch(subscriptionId, { status: 'active' });
    await ctx.db.patch(planId, { metadata: { lowValue: true } });
  });
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts })).page,
  ).toEqual([]);
  await expect(
    t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' }),
  ).rejects.toThrow('Plan not found');
  await t.run((ctx) => ctx.db.delete(planId));
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts })).page,
  ).toEqual([]);
});

test('share links never authorize workspace review requests, including live links', async () => {
  const { t, request, planId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert('shareLinks', {
      planId,
      token: 'live-public-link',
      createdBy: 'owner',
      createdAt: Date.now(),
    }),
  );
  asUser('foreign');
  await expect(request()).rejects.toThrow('Access denied');
  await t.run(async (ctx) => {
    const link = await ctx.db
      .query('shareLinks')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .first();
    if (link) await ctx.db.patch(link._id, { expiresAt: Date.now() - 1 });
  });
  expect(await t.query(api.teamReviews.eligibleReviewers, { planId })).toEqual([]);
});

test('cursor pagination never mixes unrelated reviewers and all pages remain actionable', async () => {
  const { t, request, planId } = await setup();
  for (let version = 1; version <= 4; version++) {
    await t.run((ctx) => ctx.db.patch(planId, { version }));
    await request(['alice', 'bob']);
  }
  asUser('alice');
  const first = await t.query(api.teamReviews.inbox, {
    direction: 'assigned',
    paginationOpts: { cursor: null, numItems: 2 },
  });
  const next = await t.query(api.teamReviews.inbox, {
    direction: 'assigned',
    paginationOpts: { cursor: first.continueCursor, numItems: 2 },
  });
  expect(first.page).toHaveLength(2);
  expect(next.page).toHaveLength(2);
  expect(new Set([...first.page, ...next.page].map((r) => r.id)).size).toBe(4);
  expect(first.page.filter((r) => r.canDecide)).toHaveLength(1);
});

test('reviews are included in account exports and bounded plan deletion phases', async () => {
  const { t, request, planId } = await setup();
  const [id] = await request();
  const exported = await t.query(internal.dataExport.listPlanSectionPage, {
    ownerId: 'owner',
    planId,
    section: 'reviews',
    cursor: null,
  });
  if (!exported) throw new Error('Expected owner review export');
  const exportRows: unknown = JSON.parse(exported.rowsJson);
  expect(exportRows).toEqual([expect.objectContaining({ _id: id })]);
  const assigned = await t.query(internal.dataExport.listAccountSectionPage, {
    ownerId: 'alice',
    section: 'assignedReviews',
    cursor: null,
  });
  const assignedRows: unknown = JSON.parse(assigned.rowsJson);
  expect(assignedRows).toEqual([expect.objectContaining({ _id: id })]);
  const result = await t.run((ctx) =>
    deletePlanRelatedDataBatch(ctx, { planId, phase: 'planReviewRequests', batchSize: 1 }),
  );
  expect(result.deleted).toBe(1);
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
});

test('revision fingerprints bind format and title as well as content', async () => {
  const plan = { title: 'A', content, format: 'markdown' } as Doc<'plans'>;
  expect(await reviewRevision(plan)).not.toBe(await reviewRevision({ ...plan, title: 'B' }));
  expect(await reviewRevision(plan)).not.toBe(await reviewRevision({ ...plan, format: 'html' }));
});

test('same-millisecond decisions still produce an unread owner notification that can be acknowledged', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(10000);
  const { t, request } = await setup();
  const [id] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' });
  asUser('owner');
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'sent', paginationOpts })).page[0].unread,
  ).toBe(true);
  await t.mutation(api.teamReviews.markRead, { requestId: id });
  expect(
    (await t.query(api.teamReviews.inbox, { direction: 'sent', paginationOpts })).page[0].unread,
  ).toBe(false);
});

test('account purge deletes a reviewers assigned requests without deleting another reviewers request', async () => {
  const { t, request } = await setup();
  const [aliceId, bobId] = await request(['alice', 'bob']);
  await t.run((ctx) =>
    ctx.db.insert('accountDeletionJobs', {
      ownerId: 'alice',
      status: 'deleting',
      phase: 'reviewRequestsAssigned',
      attempt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  expect(await t.run((ctx) => ctx.db.get(aliceId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(bobId))).not.toBeNull();
});

test('actual rename away and back never revives approval and records each title revision', async () => {
  const { t, request, planId } = await setup();
  const [id] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' });
  asUser('owner');
  await t.mutation(api.plans.renamePlan, {
    planId,
    title: 'Renamed authentication implementation',
  });
  expect((await t.query(api.teamReviews.forPlan, { planId, paginationOpts })).page[0].status).toBe(
    'superseded',
  );
  await t.mutation(api.plans.renamePlan, { planId, title: 'Authentication implementation' });
  expect((await t.query(api.teamReviews.forPlan, { planId, paginationOpts })).page[0].status).toBe(
    'superseded',
  );
  const versions = await t.run((ctx) =>
    ctx.db
      .query('planVersions')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .take(10),
  );
  expect(versions.map((v) => [v.version, v.title])).toEqual([
    [1, 'Authentication implementation'],
    [2, 'Renamed authentication implementation'],
    [3, 'Authentication implementation'],
  ]);
});

test('publish format changes and reverts invalidate approval through monotonically increasing versions', async () => {
  const { t, request, planId } = await setup();
  const [id] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' });
  asUser('owner');
  for (const format of ['html', 'markdown']) {
    expect(
      await t.mutation(api.plans.publishPlan, {
        localPlanId: 'team-review-fixture',
        agent: 'claude',
        title: 'Authentication implementation',
        content,
        format,
      }),
    ).toBe(planId);
    expect(
      (await t.query(api.teamReviews.forPlan, { planId, paginationOpts })).page[0].status,
    ).toBe('superseded');
  }
  expect((await t.run((ctx) => ctx.db.get(planId)))?.version).toBe(3);
});

test('CLI format updates use the live version even when a previously fetched version is stale', async () => {
  const { t, request, planId } = await setup();
  const [id] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: '' });
  asUser('owner');
  for (const format of ['html', 'markdown']) {
    await t.mutation(internal.cli.upsertPlan, {
      ownerId: 'owner',
      localPlanId: 'team-review-fixture',
      agent: 'claude',
      title: 'Authentication implementation',
      content,
      format,
      existingId: planId,
      existingVersion: 1,
    });
    expect(
      (await t.query(api.teamReviews.forPlan, { planId, paginationOpts })).page[0].status,
    ).toBe('superseded');
  }
  expect((await t.run((ctx) => ctx.db.get(planId)))?.version).toBe(3);
});

test('revoked reviewers export only their own decision, not requester content', async () => {
  const { t, request, membershipId } = await setup();
  const [id] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.decide, { requestId: id, decision: 'approved', note: 'LGTM' });
  await t.run((ctx) => ctx.db.delete(membershipId));
  const assigned = await t.query(internal.dataExport.listAccountSectionPage, {
    ownerId: 'alice',
    section: 'assignedReviews',
    cursor: null,
  });
  const [row] = JSON.parse(assigned.rowsJson) as Record<string, unknown>[];
  expect(row).toMatchObject({
    _id: id,
    status: 'approved',
    decisionNote: 'LGTM',
    accessRevoked: true,
  });
  expect(row).not.toHaveProperty('message');
  expect(row).not.toHaveProperty('planId');
  expect(row).not.toHaveProperty('workspaceOwnerId');
});

test('future plan timestamps cannot hide a later cancellation or re-flag an acknowledged superseded review', async () => {
  const { t, request, planId } = await setup();
  const [id] = await request();
  await t.run((ctx) => ctx.db.patch(planId, { updatedAt: Date.now() + 10_000_000 }));
  asUser('alice');
  await t.mutation(api.teamReviews.markRead, { requestId: id });
  asUser('owner');
  await t.mutation(api.teamReviews.cancel, { requestId: id });
  asUser('alice');
  const assigned = () => t.query(api.teamReviews.inbox, { direction: 'assigned', paginationOpts });
  expect((await assigned()).page[0]).toMatchObject({ status: 'cancelled', unread: true });
  asUser('owner');
  const [next] = await request();
  asUser('alice');
  await t.mutation(api.teamReviews.markRead, { requestId: next });
  await t.run((ctx) => ctx.db.patch(planId, { content: content + '\n' }));
  const superseded = (await assigned()).page.find((r) => r.id === next);
  expect(superseded).toMatchObject({ status: 'superseded', unread: true });
  await t.mutation(api.teamReviews.markRead, { requestId: next });
  await t.run((ctx) => ctx.db.patch(planId, { updatedAt: Date.now() + 20_000_000 }));
  expect((await assigned()).page.find((r) => r.id === next)?.unread).toBe(false);
});
