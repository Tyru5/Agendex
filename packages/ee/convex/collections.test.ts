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
    patch: () => Promise<undefined>;
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

function junction(id: string, ownerId: string, collectionId: string, planId: string): TestDocument {
  return {
    _id: id,
    _creationTime: 1,
    ownerId,
    collectionId,
    planId,
    createdAt: 1,
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
  const inserted: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const scheduled: ScheduledCall[] = [];
  const indexes: string[] = [];

  const db = {
    get: async (id: string) => documentsById.get(id) ?? null,
    delete: async (id: string) => {
      deleted.push(id);
      documentsById.delete(id);
    },
    patch: async () => undefined,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-new`;
      inserted.push({ table, value, id });
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
    state: { deleted, inserted, scheduled, indexes },
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
