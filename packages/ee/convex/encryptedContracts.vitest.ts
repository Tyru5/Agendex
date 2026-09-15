/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

vi.mock('./auth', () => ({
  authComponent: {
    getAuthUser: async () => ({ _id: 'owner', name: 'Owner' }),
    safeGetAuthUser: async () => ({ _id: 'owner', name: 'Owner' }),
  },
}));
vi.mock('./entitlements', () => ({
  requireFeature: async () => undefined,
  requireFeatureForUserId: async () => undefined,
}));
vi.mock('./subscriptions', () => ({
  hasActiveSubscription: async () => true,
  hasActiveSubscriptionForUserId: async () => true,
}));

const modules = import.meta.glob('./**/*.ts');
const envelope = {
  v: 1 as const,
  alg: 'xchacha20poly1305' as const,
  keyEpoch: 1,
  nonce: new ArrayBuffer(24),
  ciphertext: new ArrayBuffer(32),
};

async function encryptedWorkspace() {
  const t = convexTest(schema, modules);
  const planId = await t.run(async (ctx) => {
    await ctx.db.insert('workspaceCryptoSettings', {
      ownerId: 'owner',
      state: 'sealed',
      recoveryProofCommitment: 'commitment',
      activeKeyEpoch: 1,
      cryptoFormat: 1,
      ownerKdf: {
        v: 1,
        alg: 'argon2id',
        salt: new ArrayBuffer(16),
        memorySize: 65536,
        iterations: 11,
        parallelism: 1,
        dkLen: 32,
      },
      ownerPassphraseWrappedKey: envelope,
      ownerRecoveryWrappedKey: envelope,
      minimumClientProtocol: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const planId = await ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'claude',
      title: '',
      content: '',
      format: 'markdown',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      stableCryptoId: 'plan-crypto',
      keyEpoch: 1,
      encryptedSummary: envelope,
      encryptedBody: envelope,
      localPlanToken: 'local-token',
      contentToken: 'content-token',
      lowValue: false,
    });
    await ctx.db.insert('planVersions', {
      ownerId: 'owner',
      planId,
      version: 1,
      title: '',
      content: '',
      format: 'markdown',
      createdAt: 1,
      stableCryptoId: 'version-crypto',
      keyEpoch: 1,
      encryptedSummary: envelope,
      encryptedBody: envelope,
    });
    return planId;
  });
  return { t, planId };
}

test('encrypted plan summaries, lazy bodies, details and history survive public DTOs', async () => {
  const { t, planId } = await encryptedWorkspace();
  const result = await t.query(api.plans.getMyPublishedPlans, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(result.page).toHaveLength(1);
  expect(result.page[0]).toMatchObject({
    stableCryptoId: 'plan-crypto',
    keyEpoch: 1,
    encryptedSummary: envelope,
    localPlanToken: 'local-token',
    lowValue: false,
  });
  expect(result.page[0]).not.toHaveProperty('encryptedBody');
  expect(result.page[0]).not.toHaveProperty('content');
  expect(await t.query(api.plans.getMyPlanContent, { planId })).toMatchObject({
    encryptedBody: envelope,
    stableCryptoId: 'plan-crypto',
    keyEpoch: 1,
  });
  expect(await t.query(api.plans.getPlan, { planId })).toMatchObject({
    encryptedSummary: envelope,
    encryptedBody: envelope,
  });
  expect(await t.query(api.planVersions.listForPlan, { planId })).toMatchObject([
    { stableCryptoId: 'version-crypto', keyEpoch: 1, encryptedSummary: envelope },
  ]);
  expect(await t.query(api.planVersions.getVersion, { planId, version: 1 })).toMatchObject({
    stableCryptoId: 'version-crypto',
    keyEpoch: 1,
    encryptedSummary: envelope,
    encryptedBody: envelope,
  });
});

test('encrypted content list validators accept the complete stored records', async () => {
  const { t, planId } = await encryptedWorkspace();
  const metadata = { clientCryptoProtocol: 1, keyEpoch: 1 };
  await t.mutation(api.tags.createTag, {
    ...metadata,
    name: '',
    stableCryptoId: 'tag',
    encryptedName: envelope,
    nameToken: 'tag-token',
  });
  const collectionId = await t.mutation(api.collections.createCollection, {
    ...metadata,
    name: '',
    stableCryptoId: 'collection',
    encryptedName: envelope,
    encryptedDescription: envelope,
    nameToken: 'collection-token',
  });
  await t.mutation(api.collections.renameCollection, {
    ...metadata,
    collectionId,
    name: '',
    encryptedName: envelope,
    encryptedDescription: envelope,
    nameToken: 'renamed-token',
  });
  await t.mutation(api.annotations.createAnnotation, {
    ...metadata,
    planId,
    type: 'comment',
    anchor: {},
    stableCryptoId: 'annotation',
    encryptedAnnotation: envelope,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert('plannotatorWritebacks', {
      ownerId: 'owner',
      planId,
      localPlanId: '',
      feedback: '',
      source: 'agendex-cloud',
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 10000,
      stableCryptoId: 'writeback',
      keyEpoch: 1,
      encryptedWriteback: envelope,
      localPlanToken: 'local-token',
    });
  });
  expect(await t.query(api.tags.listMyTags, {})).toMatchObject([{ encryptedName: envelope }]);
  expect(await t.query(api.collections.listMyCollections, {})).toMatchObject([
    { encryptedName: envelope, encryptedDescription: envelope, nameToken: 'renamed-token' },
  ]);
  expect(await t.query(api.annotations.listForPlan, { planId })).toMatchObject([
    { ownerId: 'owner', encryptedAnnotation: envelope },
  ]);
  expect(await t.query(api.plannotator.listWritebacksForPlan, { planId })).toMatchObject([
    { encryptedWriteback: envelope, localPlanToken: 'local-token' },
  ]);
});

test('encrypted-only annotation edits validate ciphertext and require matching epochs', async () => {
  const { t, planId } = await encryptedWorkspace();
  const annotationId = await t.mutation(api.annotations.createAnnotation, {
    planId,
    type: 'comment',
    anchor: {},
    stableCryptoId: 'annotation',
    clientCryptoProtocol: 1,
    keyEpoch: 1,
    encryptedAnnotation: envelope,
  });
  for (const encryptedAnnotation of [
    { ...envelope, keyEpoch: 2 },
    { ...envelope, nonce: new ArrayBuffer(1) },
  ]) {
    await expect(
      t.mutation(api.annotations.updateAnnotation, {
        annotationId,
        clientCryptoProtocol: 1,
        keyEpoch: 1,
        encryptedAnnotation,
      }),
    ).rejects.toThrow();
  }
  await expect(
    t.mutation(api.annotations.updateAnnotation, {
      annotationId,
      clientCryptoProtocol: 1,
      keyEpoch: 2,
      encryptedAnnotation: envelope,
    }),
  ).rejects.toThrow('Encrypted annotation metadata is required');
  await t.mutation(api.annotations.updateAnnotation, {
    annotationId,
    clientCryptoProtocol: 1,
    status: 'resolved',
  });
  expect(await t.run((ctx) => ctx.db.get(annotationId))).toMatchObject({
    keyEpoch: 1,
    encryptedAnnotation: envelope,
    status: 'resolved',
  });
});

test('encrypted collections cannot lose their name and records cannot carry a stale epoch', async () => {
  const { t } = await encryptedWorkspace();
  await expect(
    t.mutation(api.collections.createCollection, {
      clientCryptoProtocol: 1,
      keyEpoch: 1,
      name: '',
      stableCryptoId: 'collection',
      encryptedDescription: envelope,
      nameToken: 'collection-token',
    }),
  ).rejects.toThrow('Encrypted collection metadata is required');
  await expect(
    t.mutation(api.tags.createTag, {
      clientCryptoProtocol: 1,
      keyEpoch: 2,
      name: '',
      stableCryptoId: 'tag',
      encryptedName: envelope,
      nameToken: 'tag-token',
    }),
  ).rejects.toThrow('Encrypted tag metadata is required');
});

test('legacy editor and rename mutations cannot write plaintext into sealed plans', async () => {
  const { t, planId } = await encryptedWorkspace();
  await expect(
    t.mutation(api.plans.renamePlan, { planId, title: 'Private title' }),
  ).rejects.toThrow('This client must be upgraded before writing to this workspace');
  await expect(
    t.mutation(api.plans.updatePlanContent, {
      planId,
      title: 'Private title',
      content: 'Private content',
    }),
  ).rejects.toThrow('This client must be upgraded before writing to this workspace');
  expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({ title: '', content: '' });
});

test('encrypted rename and editor preserve separately encrypted history and reject plaintext', async () => {
  const { t, planId } = await encryptedWorkspace();
  const summary = { ...envelope, ciphertext: new Uint8Array(32).fill(4).buffer };
  await t.mutation(api.plans.renamePlan, {
    planId,
    title: '',
    clientCryptoProtocol: 1,
    keyEpoch: 1,
    encryptedSummary: summary,
    contentToken: 'renamed-content-token',
  });
  expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({
    encryptedSummary: summary,
    encryptedBody: envelope,
    version: 1,
  });
  await expect(
    t.mutation(api.plans.renamePlan, {
      planId,
      title: 'Leak',
      clientCryptoProtocol: 1,
      keyEpoch: 1,
      encryptedSummary: summary,
    }),
  ).rejects.toThrow('Plaintext title is not allowed');
  const versionEnvelope = { ...envelope, ciphertext: new Uint8Array(32).fill(5).buffer };
  await t.mutation(api.plans.updatePlanContent, {
    planId,
    title: '',
    content: '',
    clientCryptoProtocol: 1,
    keyEpoch: 1,
    encryptedSummary: summary,
    encryptedBody: summary,
    versionStableCryptoId: 'edited-version',
    encryptedVersionSummary: versionEnvelope,
    encryptedVersionBody: versionEnvelope,
    contentToken: 'edited-token',
    lowValue: false,
  });
  expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({
    stableCryptoId: 'plan-crypto',
    encryptedSummary: summary,
    encryptedBody: summary,
    version: 2,
  });
  expect(await t.query(api.planVersions.getVersion, { planId, version: 2 })).toMatchObject({
    stableCryptoId: 'edited-version',
    encryptedSummary: versionEnvelope,
    encryptedBody: versionEnvelope,
  });
});

test('republishing keeps live plan ciphertext separate from version ciphertext', async () => {
  const { t, planId } = await encryptedWorkspace();
  const versionEnvelope = { ...envelope, ciphertext: new Uint8Array(32).fill(3).buffer };
  const args = {
    localPlanId: '',
    agent: 'claude',
    title: '',
    content: '',
    format: 'markdown',
    clientCryptoProtocol: 1,
    keyEpoch: 1,
    stableCryptoId: 'plan-crypto',
    encryptedSummary: envelope,
    encryptedBody: envelope,
    versionStableCryptoId: 'new-version-crypto',
    encryptedVersionSummary: versionEnvelope,
    encryptedVersionBody: versionEnvelope,
    localPlanToken: 'local-token',
    contentToken: 'changed-content-token',
    lowValue: false,
  };
  expect(await t.mutation(api.plans.publishPlan, args)).toBe(planId);
  expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({
    stableCryptoId: 'plan-crypto',
    encryptedSummary: envelope,
    encryptedBody: envelope,
    version: 2,
  });
  expect(await t.query(api.planVersions.getVersion, { planId, version: 2 })).toMatchObject({
    stableCryptoId: 'new-version-crypto',
    encryptedSummary: versionEnvelope,
    encryptedBody: versionEnvelope,
  });
  await expect(
    t.mutation(api.plans.publishPlan, {
      ...args,
      stableCryptoId: 'different-plan-crypto',
    }),
  ).rejects.toThrow('Encrypted plan identity does not match the existing plan');
});

for (const phase of ['tags', 'collections', 'planAnnotations'] as const) {
  test(`${phase} sealing rejects a stale snapshot without overwriting a concurrent edit`, async () => {
    const { t, planId } = await encryptedWorkspace();
    const edit = { ...envelope, ciphertext: new Uint8Array(32).fill(9).buffer };
    const metadata = { clientCryptoProtocol: 1, keyEpoch: 1 };
    const rowId =
      phase === 'tags'
        ? await t.mutation(api.tags.createTag, {
            ...metadata,
            name: '',
            stableCryptoId: 'row-crypto',
            encryptedName: envelope,
            nameToken: 'initial-token',
          })
        : phase === 'collections'
          ? await t.mutation(api.collections.createCollection, {
              ...metadata,
              name: '',
              stableCryptoId: 'row-crypto',
              encryptedName: envelope,
              nameToken: 'initial-token',
            })
          : await t.mutation(api.annotations.createAnnotation, {
              ...metadata,
              planId,
              type: 'comment',
              anchor: {},
              stableCryptoId: 'row-crypto',
              encryptedAnnotation: envelope,
            });
    const settingsId = await t.run(async (ctx) => {
      const settings = await ctx.db.query('workspaceCryptoSettings').first();
      if (!settings) throw new Error('Missing test workspace');
      const now = Date.now();
      await ctx.db.patch(settings._id, {
        state: 'sealing',
        operation: {
          id: 'operation',
          kind: 'seal',
          phase,
          processed: 0,
          leaseId: 'lease',
          leaseExpiresAt: now + 60000,
          startedAt: now,
          updatedAt: now,
          targetEpoch: 1,
        },
      });
      return settings._id;
    });
    const batch = await t.query(api.workspaceCryptoSeal.getWorkspaceSealBatch, {
      phase,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(batch.page).toHaveLength(1);
    const digest = batch.page[0]?.expectedSnapshotDigest;
    if (!digest) throw new Error('Missing seal snapshot digest');
    const progress = { leaseId: 'lease', continueCursor: batch.continueCursor, isDone: true };
    const seal = (
      expectedSnapshotDigest: string,
      encrypted: typeof envelope,
      nameToken: string,
    ) => {
      const item = { expectedSnapshotDigest, stableCryptoId: 'row-crypto', keyEpoch: 1 };
      if (phase === 'tags')
        return t.mutation(api.workspaceCryptoSeal.sealTagsBatch, {
          ...progress,
          items: [{ ...item, id: rowId as Id<'tags'>, encryptedName: encrypted, nameToken }],
        });
      if (phase === 'collections')
        return t.mutation(api.workspaceCryptoSeal.sealCollectionsBatch, {
          ...progress,
          items: [{ ...item, id: rowId as Id<'collections'>, encryptedName: encrypted, nameToken }],
        });
      return t.mutation(api.workspaceCryptoSeal.sealAnnotationsBatch, {
        ...progress,
        items: [{ ...item, id: rowId as Id<'planAnnotations'>, encryptedAnnotation: encrypted }],
      });
    };
    if (phase === 'tags')
      await t.mutation(api.tags.renameTag, {
        ...metadata,
        tagId: rowId as Id<'tags'>,
        name: '',
        encryptedName: edit,
        nameToken: 'edited-token',
      });
    else if (phase === 'collections')
      await t.mutation(api.collections.renameCollection, {
        ...metadata,
        collectionId: rowId as Id<'collections'>,
        name: '',
        encryptedName: edit,
        nameToken: 'edited-token',
      });
    else
      await t.mutation(api.annotations.updateAnnotation, {
        ...metadata,
        annotationId: rowId as Id<'planAnnotations'>,
        encryptedAnnotation: edit,
      });
    await expect(seal(digest, envelope, 'initial-token')).rejects.toThrow(
      'Record changed while it was being sealed',
    );
    expect(await t.run((ctx) => ctx.db.get(rowId))).toMatchObject(
      phase === 'planAnnotations' ? { encryptedAnnotation: edit } : { encryptedName: edit },
    );
    expect(await t.run((ctx) => ctx.db.get(settingsId))).toMatchObject({
      operation: { phase, processed: 0 },
    });
    const refreshed = await t.query(api.workspaceCryptoSeal.getWorkspaceSealBatch, {
      phase,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const refreshedDigest = refreshed.page[0]?.expectedSnapshotDigest;
    if (!refreshedDigest) throw new Error('Missing refreshed seal snapshot digest');
    expect(refreshedDigest).not.toBe(digest);
    await seal(refreshedDigest, edit, 'edited-token');
    expect(await t.run((ctx) => ctx.db.get(rowId))).toMatchObject(
      phase === 'planAnnotations' ? { encryptedAnnotation: edit } : { encryptedName: edit },
    );
    expect(await t.run((ctx) => ctx.db.get(settingsId))).toMatchObject({
      operation: { processed: 1 },
    });
  });
}
