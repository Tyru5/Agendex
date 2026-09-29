import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import * as authModule from './auth';
import * as entitlementsModule from './entitlements';

const realAuthModule = { ...authModule };
const realEntitlementsModule = { ...entitlementsModule };

let currentUser = { _id: 'user-a' };

mock.module('./auth', () => ({
  authComponent: {
    getAuthUser: async () => currentUser,
  },
}));

mock.module('./entitlements', () => ({
  requireFeature: async () => undefined,
}));

// These dependencies must be mocked before collections.ts is evaluated.
const collections = await import('./collections');

afterAll(() => {
  mock.module('./auth', () => realAuthModule);
  mock.module('./entitlements', () => realEntitlementsModule);
});

type TestDocument = {
  _id: string;
  ownerId: string;
  collectionId?: string;
  planId?: string;
  [field: string]: unknown;
};

type ScheduledCall = {
  delay: number;
  args: Record<string, unknown>;
};

type TestIndexRange = {
  eq: (field: string, value: unknown) => TestIndexRange;
};

type TestQueryResult = {
  first: () => Promise<TestDocument | null>;
  collect: () => Promise<TestDocument[]>;
  take: (limit: number) => Promise<TestDocument[]>;
};

type TestContext = {
  db: {
    get: (id: string) => Promise<TestDocument | null>;
    delete: (id: string) => Promise<void>;
    patch: (id: string, value: Record<string, unknown>) => Promise<void>;
    insert: (table: string, value: Record<string, unknown>) => Promise<string>;
    query: (table: string) => {
      withIndex: (
        indexName: string,
        configure: (range: TestIndexRange) => unknown,
      ) => TestQueryResult;
    };
  };
  scheduler: {
    runAfter: (
      delay: number,
      functionReference: unknown,
      args: Record<string, unknown>,
    ) => Promise<void>;
  };
  state: {
    deleted: string[];
    patched: string[];
    inserted: Array<{ table: string; value: Record<string, unknown>; id: string }>;
    scheduled: ScheduledCall[];
    indexes: string[];
  };
};

type RegisteredHandler<Args, Result> = {
  _handler: (ctx: TestContext, args: Args) => Promise<Result>;
};

function handlerOf<Args, Result>(registered: unknown) {
  return (registered as RegisteredHandler<Args, Result>)._handler;
}

function collection(id: string, ownerId: string): TestDocument {
  return {
    _id: id,
    _creationTime: 1,
    ownerId,
    name: id,
    nameLc: id,
    createdAt: 1,
    updatedAt: 1,
  };
}

function plan(id: string, ownerId: string): TestDocument {
  return {
    _id: id,
    _creationTime: 1,
    ownerId,
    agent: 'test',
    title: id,
    content: '# Plan',
    format: 'markdown',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function junction(
  id: string,
  ownerId: string,
  collectionId: string,
  planId: string,
  fields: Partial<TestDocument> = {},
): TestDocument {
  return {
    _id: id,
    _creationTime: 1,
    ownerId,
    collectionId,
    planId,
    createdAt: 1,
    ...fields,
  };
}

function createContext({
  documents = [],
  junctions = [],
}: {
  documents?: TestDocument[];
  junctions?: TestDocument[];
} = {}): TestContext {
  const documentsById = new Map(documents.map((document) => [document._id, document]));
  const rowsByTable = new Map<string, TestDocument[]>([['collectionPlans', [...junctions]]]);
  const deleted: string[] = [];
  const patched: string[] = [];
  const inserted: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const scheduled: ScheduledCall[] = [];
  const indexes: string[] = [];

  const db = {
    get: async (id: string) => documentsById.get(id) ?? null,
    delete: async (id: string) => {
      deleted.push(id);
      documentsById.delete(id);
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      patched.push(id);
      const row = [...rowsByTable.values()].flat().find((candidate) => candidate._id === id);
      Object.assign(row ?? documentsById.get(id) ?? {}, value);
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-new`;
      inserted.push({ table, value, id });
      const ownerId = typeof value.ownerId === 'string' ? value.ownerId : '';
      rowsByTable.set(table, [
        ...(rowsByTable.get(table) ?? []),
        { ...value, _id: id, _creationTime: Date.now(), ownerId },
      ]);
      return id;
    },
    query: (table: string) => ({
      withIndex: (indexName: string, configure: (range: TestIndexRange) => unknown) => {
        indexes.push(indexName);
        const equalities = new Map<string, unknown>();
        const range = {
          eq(field: string, value: unknown) {
            equalities.set(field, value);
            return range;
          },
        };
        configure(range);
        const matchingRows = (rowsByTable.get(table) ?? []).filter((row) =>
          [...equalities].every(([field, value]) => row[field] === value),
        );
        return {
          first: async () => matchingRows[0] ?? null,
          collect: async () => matchingRows,
          take: async (limit: number) => matchingRows.slice(0, limit),
        };
      },
    }),
  };

  return {
    db,
    scheduler: {
      runAfter: async (
        delay: number,
        _functionReference: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ delay, args });
      },
    },
    state: { deleted, patched, inserted, scheduled, indexes },
  };
}

beforeEach(() => {
  currentUser = { _id: 'user-a' };
});

test('foreign plans cannot be attached or queried for collection IDs', async () => {
  const ctx = createContext({
    documents: [collection('collection-a', 'user-a'), plan('plan-b', 'user-b')],
    junctions: [junction('junction-b', 'user-b', 'collection-a', 'plan-b')],
  });

  await expect(
    handlerOf<{ collectionId: string; planId: string }, string>(collections.addPlanToCollection)(
      ctx,
      { collectionId: 'collection-a', planId: 'plan-b' },
    ),
  ).rejects.toThrow('Plan not found');
  await expect(
    handlerOf<{ planId: string }, string[]>(collections.getCollectionsForPlan)(ctx, {
      planId: 'plan-b',
    }),
  ).rejects.toThrow('Plan not found');

  expect(ctx.state.inserted).toHaveLength(0);
  expect(ctx.state.indexes).toHaveLength(0);
});

test('foreign collections cannot be mutated or queried', async () => {
  const ctx = createContext({
    documents: [collection('collection-b', 'user-b'), plan('plan-a', 'user-a')],
  });

  await expect(
    handlerOf<{ collectionId: string; planId: string }, string>(collections.addPlanToCollection)(
      ctx,
      { collectionId: 'collection-b', planId: 'plan-a' },
    ),
  ).rejects.toThrow('Collection not found');
  await expect(
    handlerOf<{ collectionId: string }, string[]>(collections.getPlansInCollection)(ctx, {
      collectionId: 'collection-b',
    }),
  ).rejects.toThrow('Collection not found');

  expect(ctx.state.inserted).toHaveLength(0);
});

test('forged junction ownership and foreign parents are excluded from reads and removal', async () => {
  const ctx = createContext({
    documents: [
      collection('collection-a', 'user-a'),
      collection('collection-b', 'user-b'),
      plan('plan-a', 'user-a'),
      plan('plan-b', 'user-b'),
    ],
    junctions: [
      junction('junction-foreign-owner', 'user-b', 'collection-a', 'plan-a'),
      junction('junction-foreign-collection', 'user-a', 'collection-b', 'plan-a'),
      junction('junction-foreign-plan', 'user-a', 'collection-a', 'plan-b'),
    ],
  });

  const collectionIds = await handlerOf<{ planId: string }, string[]>(
    collections.getCollectionsForPlan,
  )(ctx, { planId: 'plan-a' });
  const planIds = await handlerOf<{ collectionId: string }, string[]>(
    collections.getPlansInCollection,
  )(ctx, { collectionId: 'collection-a' });
  await expect(
    handlerOf<{ collectionId: string; planId: string }, null>(collections.removePlanFromCollection)(
      ctx,
      { collectionId: 'collection-a', planId: 'plan-a' },
    ),
  ).rejects.toThrow('Plan not in collection');

  expect(collectionIds).toEqual([]);
  expect(planIds).toEqual([]);
  expect(ctx.state.deleted).toEqual([]);
  expect(ctx.state.indexes).toContain('by_owner_and_plan');
  expect(ctx.state.indexes).toContain('by_owner_and_collection');
  expect(ctx.state.indexes).toContain('by_owner_and_collection_and_plan');
});

test('collection deletion scopes cleanup to the deleted collection owner', async () => {
  const ctx = createContext({
    documents: [collection('collection-a', 'user-a')],
    junctions: [
      junction('junction-a', 'user-a', 'collection-a', 'plan-a'),
      junction('junction-forged', 'user-b', 'collection-a', 'plan-b'),
    ],
  });

  await handlerOf<{ collectionId: string }, null>(collections.deleteCollection)(ctx, {
    collectionId: 'collection-a',
  });
  await handlerOf<{ collectionId: string; ownerId: string }, null>(
    collections.cleanupCollectionPlans,
  )(ctx, { collectionId: 'collection-a', ownerId: 'user-a' });

  expect(ctx.state.deleted).toEqual(['collection-a', 'junction-a']);
  expect(ctx.state.scheduled).toEqual([
    { delay: 0, args: { collectionId: 'collection-a', ownerId: 'user-a' } },
  ]);
  expect(ctx.state.indexes).toContain('by_owner_and_collection');
});

test('owned collection membership behavior remains unchanged', async () => {
  const ctx = createContext({
    documents: [collection('collection-a', 'user-a'), plan('plan-a', 'user-a')],
  });

  const insertedId = await handlerOf<{ collectionId: string; planId: string }, string>(
    collections.addPlanToCollection,
  )(ctx, { collectionId: 'collection-a', planId: 'plan-a' });

  expect(insertedId).toBe('collectionPlans-new');
  expect(ctx.state.inserted).toEqual([
    {
      table: 'collectionPlans',
      id: 'collectionPlans-new',
      value: {
        ownerId: 'user-a',
        collectionId: 'collection-a',
        planId: 'plan-a',
        position: 0,
        createdAt: expect.any(Number),
      },
    },
  ]);

  const populatedCtx = createContext({
    documents: [collection('collection-a', 'user-a'), plan('plan-a', 'user-a')],
    junctions: [junction('junction-a', 'user-a', 'collection-a', 'plan-a')],
  });
  const collectionIds = await handlerOf<{ planId: string }, string[]>(
    collections.getCollectionsForPlan,
  )(populatedCtx, { planId: 'plan-a' });
  const planIds = await handlerOf<{ collectionId: string }, string[]>(
    collections.getPlansInCollection,
  )(populatedCtx, { collectionId: 'collection-a' });
  await handlerOf<{ collectionId: string; planId: string }, null>(
    collections.removePlanFromCollection,
  )(populatedCtx, { collectionId: 'collection-a', planId: 'plan-a' });

  expect(collectionIds).toEqual(['collection-a']);
  expect(planIds).toEqual(['plan-a']);
  expect(populatedCtx.state.deleted).toEqual(['junction-a']);
});

function planOrder(ctx: TestContext): Promise<string[]> {
  return handlerOf<{ collectionId: string }, string[]>(collections.getPlansInCollection)(ctx, {
    collectionId: 'collection-a',
  });
}

function addPlan(ctx: TestContext, planId: string): Promise<string> {
  return handlerOf<{ collectionId: string; planId: string }, string>(
    collections.addPlanToCollection,
  )(ctx, { collectionId: 'collection-a', planId });
}

function movePlan(
  ctx: TestContext,
  planId: string,
  toIndex: number,
  collectionId = 'collection-a',
): Promise<null> {
  return handlerOf<{ collectionId: string; planId: string; toIndex: number }, null>(
    collections.moveCollectionPlan,
  )(ctx, { collectionId, planId, toIndex });
}

test('collection order lists legacy memberships first by creation time and appends new plans', async () => {
  const ctx = createContext({
    documents: [
      collection('collection-a', 'user-a'),
      plan('positioned', 'user-a'),
      plan('legacy-newer', 'user-a'),
      plan('legacy-older', 'user-a'),
      plan('added', 'user-a'),
    ],
    junctions: [
      junction('junction-positioned', 'user-a', 'collection-a', 'positioned', {
        _creationTime: 10,
        position: 0,
      }),
      junction('junction-legacy-newer', 'user-a', 'collection-a', 'legacy-newer', {
        _creationTime: 30,
      }),
      junction('junction-legacy-older', 'user-a', 'collection-a', 'legacy-older', {
        _creationTime: 20,
      }),
    ],
  });

  expect(await planOrder(ctx)).toEqual(['legacy-older', 'legacy-newer', 'positioned']);

  await addPlan(ctx, 'added');
  expect(ctx.state.patched).toEqual([]);
  expect(ctx.state.inserted[0]?.value.position).toBe(3);
  expect(await planOrder(ctx)).toEqual(['legacy-older', 'legacy-newer', 'positioned', 'added']);

  expect(await addPlan(ctx, 'legacy-older')).toBe('junction-legacy-older');
  expect(ctx.state.inserted).toHaveLength(1);
  expect(await planOrder(ctx)).toEqual(['legacy-older', 'legacy-newer', 'positioned', 'added']);
});

test('adding a plan near the membership limit does not backfill legacy positions', async () => {
  const ctx = createContext({
    documents: [collection('collection-a', 'user-a'), plan('added', 'user-a')],
    junctions: Array.from({ length: 999 }, (_, index) =>
      junction(`junction-${index}`, 'user-a', 'collection-a', `plan-${index}`),
    ),
  });

  await addPlan(ctx, 'added');
  expect(ctx.state.patched).toEqual([]);
  expect(ctx.state.inserted).toHaveLength(1);
  expect(ctx.state.inserted[0]?.value.position).toBe(999);
});

test('adding after sparse positions preserves the existing order', async () => {
  const ctx = createContext({
    documents: [
      collection('collection-a', 'user-a'),
      plan('a', 'user-a'),
      plan('b', 'user-a'),
      plan('added', 'user-a'),
    ],
    junctions: [
      junction('junction-a', 'user-a', 'collection-a', 'a', { position: 3 }),
      junction('junction-b', 'user-a', 'collection-a', 'b', { position: 9 }),
    ],
  });

  await addPlan(ctx, 'added');
  expect(ctx.state.patched).toEqual([]);
  expect(ctx.state.inserted[0]?.value.position).toBe(10);
  expect(await planOrder(ctx)).toEqual(['a', 'b', 'added']);
});

test('moveCollectionPlan moves within listed plans and rejects out-of-range targets', async () => {
  const ctx = createContext({
    documents: [
      collection('collection-a', 'user-a'),
      plan('a', 'user-a'),
      plan('b', 'user-a'),
      plan('c', 'user-a'),
    ],
    junctions: [
      junction('junction-a', 'user-a', 'collection-a', 'a', { position: 0 }),
      junction('junction-deleted', 'user-a', 'collection-a', 'deleted-plan', { position: 1 }),
      junction('junction-b', 'user-a', 'collection-a', 'b', { position: 2 }),
      junction('junction-c', 'user-a', 'collection-a', 'c', { position: 3 }),
    ],
  });

  expect(await planOrder(ctx)).toEqual(['a', 'b', 'c']);
  await movePlan(ctx, 'c', 0);
  expect(await planOrder(ctx)).toEqual(['c', 'a', 'b']);
  await movePlan(ctx, 'c', 2);
  expect(await planOrder(ctx)).toEqual(['a', 'b', 'c']);
  await movePlan(ctx, 'a', 1);
  expect(await planOrder(ctx)).toEqual(['b', 'a', 'c']);

  for (const toIndex of [3, -1, 0.5]) {
    await expect(movePlan(ctx, 'a', toIndex)).rejects.toThrow('Position out of range');
  }
  expect(await planOrder(ctx)).toEqual(['b', 'a', 'c']);
});

test('moveCollectionPlan requires an owned collection, owned plan, and owned membership', async () => {
  const ctx = createContext({
    documents: [
      collection('collection-a', 'user-a'),
      collection('collection-b', 'user-b'),
      plan('member', 'user-a'),
      plan('outsider', 'user-a'),
      plan('forged-member', 'user-a'),
      plan('foreign', 'user-b'),
    ],
    junctions: [
      junction('junction-member', 'user-a', 'collection-a', 'member', { position: 0 }),
      junction('junction-forged', 'user-b', 'collection-a', 'forged-member', { position: 1 }),
      junction('junction-foreign', 'user-b', 'collection-b', 'foreign', { position: 0 }),
    ],
  });

  await expect(movePlan(ctx, 'member', 0, 'collection-b')).rejects.toThrow('Collection not found');
  await expect(movePlan(ctx, 'foreign', 0)).rejects.toThrow('Plan not found');
  await expect(movePlan(ctx, 'outsider', 0)).rejects.toThrow('Plan not in collection');
  await expect(movePlan(ctx, 'forged-member', 0)).rejects.toThrow('Plan not in collection');

  currentUser = { _id: 'user-b' };
  await expect(movePlan(ctx, 'member', 0)).rejects.toThrow('Collection not found');
});
