/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const authState = vi.hoisted(() => ({ userId: 'owner' }));
afterEach(() => {
  authState.userId = 'owner';
});
vi.mock('./auth', () => ({
  authComponent: {
    getAuthUser: async () => ({ _id: authState.userId, name: 'User' }),
    safeGetAuthUser: async () => ({ _id: authState.userId, name: 'User' }),
  },
}));
vi.mock('./entitlements', () => ({
  requireFeature: async () => undefined,
  requireFeatureForUserId: async () => undefined,
}));
const modules = import.meta.glob('./**/*.ts');
const envelope = (keyEpoch: number) => ({
  v: 1 as const,
  alg: 'xchacha20poly1305' as const,
  keyEpoch,
  nonce: new ArrayBuffer(24),
  ciphertext: new ArrayBuffer(32),
});

async function workspace() {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert('workspaceCryptoSettings', {
      ownerId: 'owner',
      state: 'rotating',
      activeKeyEpoch: 2,
      cryptoFormat: 1,
      recoveryProofCommitment: 'commitment',
      minimumClientProtocol: 1,
      ownerKdf: {
        v: 1,
        alg: 'argon2id',
        salt: new ArrayBuffer(16),
        memorySize: 65536,
        iterations: 11,
        parallelism: 1,
        dkLen: 32,
      },
      ownerPassphraseWrappedKey: envelope(2),
      ownerRecoveryWrappedKey: envelope(2),
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return t;
}

test('workspace members can comment without share links, and removal revokes access', async () => {
  const t = await workspace();
  const { planId, membershipId } = await t.run(async (ctx) => ({
    planId: await ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'claude',
      title: '',
      content: '',
      format: 'markdown',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
    membershipId: await ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: 'owner',
      memberId: 'member',
      email: 'member@example.test',
      emailLc: 'member@example.test',
      role: 'member',
      addedAt: 1,
    }),
  }));
  authState.userId = 'member';
  const commentId = await t.mutation(api.comments.addComment, {
    planId,
    body: '',
    stableCryptoId: 'member-comment',
    keyEpoch: 2,
    clientCryptoProtocol: 1,
    encryptedComment: envelope(2),
  });
  expect(await t.query(api.comments.getComments, { planId })).toHaveLength(1);
  await t.mutation(api.comments.deleteComment, { commentId });
  expect(await t.query(api.comments.getComments, { planId })).toHaveLength(0);
  await t.run((ctx) => ctx.db.delete(membershipId));
  await expect(t.query(api.comments.getComments, { planId })).rejects.toThrow(
    'Share token required',
  );
});

test('locked heartbeat preserves old ciphertext epoch; unlocked replacement clears omitted old IP', async () => {
  const t = await workspace();
  const id = await t.run((ctx) =>
    ctx.db.insert('daemonHeartbeats', {
      ownerId: 'owner',
      deviceId: 'device',
      stableCryptoId: 'device',
      keyEpoch: 1,
      encryptedHostname: envelope(1),
      encryptedIpAddress: envelope(1),
      lastSeenAt: Date.now(),
    }),
  );
  const args = {
    ownerId: 'owner',
    deviceId: 'device',
    stableCryptoId: 'device',
    keyEpoch: 2,
    clientCryptoProtocol: 1,
  };
  await t.mutation(internal.cli.upsertHeartbeat, { ...args, cryptoUnlocked: false });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    keyEpoch: 1,
    encryptedHostname: envelope(1),
    encryptedIpAddress: envelope(1),
  });
  await t.mutation(internal.cli.upsertHeartbeat, {
    ...args,
    cryptoUnlocked: true,
    encryptedHostname: envelope(2),
  });
  const updated = await t.run((ctx) => ctx.db.get(id));
  expect(updated).toMatchObject({ keyEpoch: 2, encryptedHostname: envelope(2) });
  expect(updated?.encryptedIpAddress).toBeUndefined();
  await expect(
    t.mutation(internal.cli.upsertHeartbeat, {
      ...args,
      usageSnapshots: { privatePath: '/secret' },
    }),
  ).rejects.toThrow('usage sync');
});

test('comment DTO retains all encrypted fields and edits cannot mislabel retained attachments', async () => {
  const t = await workspace();
  const { planId, commentId, attachmentId } = await t.run(async (ctx) => {
    const planId = await ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'claude',
      title: '',
      content: '',
      format: 'markdown',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const attachmentId = await ctx.storage.store(new Blob(['ciphertext']));
    const commentId = await ctx.db.insert('comments', {
      ownerId: 'owner',
      planId,
      authorId: 'owner',
      authorName: '',
      body: '',
      stableCryptoId: 'comment',
      keyEpoch: 1,
      encryptedComment: envelope(1),
      encryptedAttachments: envelope(1),
      createdAt: 1,
      attachments: [
        {
          storageId: attachmentId,
          contentType: 'application/octet-stream',
          size: 10,
          encrypted: true,
          stableCryptoId: 'attachment',
          keyEpoch: 1,
        },
      ],
    });
    return { planId, commentId, attachmentId };
  });
  const rows = await t.query(api.comments.getComments, { planId });
  expect(rows[0]).toMatchObject({
    ownerId: 'owner',
    stableCryptoId: 'comment',
    keyEpoch: 1,
    encryptedComment: envelope(1),
    encryptedAttachments: envelope(1),
    attachments: [
      { storageId: attachmentId, encrypted: true, stableCryptoId: 'attachment', keyEpoch: 1 },
    ],
  });
  await expect(
    t.mutation(api.comments.editComment, {
      commentId,
      body: '',
      keyEpoch: 2,
      clientCryptoProtocol: 1,
      encryptedComment: envelope(2),
    }),
  ).rejects.toThrow('rotation');
  await expect(
    t.mutation(api.comments.addComment, {
      planId,
      body: '',
      stableCryptoId: 'new',
      keyEpoch: 99,
      clientCryptoProtocol: 1,
      encryptedComment: envelope(2),
    }),
  ).rejects.toThrow('metadata');
});
