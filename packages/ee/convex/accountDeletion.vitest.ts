/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { ACCOUNT_DELETION_BATCH_SIZE, type AccountDeletionPhase } from './accountDeletionState';
import schema from './schema';
import { resolveWorkspaceCryptoPolicy } from './workspaceCrypto';

const modules = import.meta.glob('./**/*.ts');
const envelope = {
  v: 1 as const,
  alg: 'xchacha20poly1305' as const,
  keyEpoch: 1,
  nonce: new ArrayBuffer(24),
  ciphertext: new ArrayBuffer(48),
};
const kdf = {
  v: 1 as const,
  alg: 'argon2id' as const,
  salt: new ArrayBuffer(16),
  memorySize: 65536,
  iterations: 11,
  parallelism: 1,
  dkLen: 32 as const,
};
const identity = {
  publicKey: new ArrayBuffer(32),
  encryptedPrivateKey: envelope,
  recoveryWrappedPrivateKey: envelope,
  kdf,
  keyVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const grant = {
  keyEpoch: 1,
  kem: 'DHKEM(X25519, HKDF-SHA256)' as const,
  kdf: 'HKDF-SHA256' as const,
  aead: 'ChaCha20Poly1305' as const,
  encapsulatedKey: new ArrayBuffer(32),
  ciphertext: new ArrayBuffer(48),
  createdAt: 1,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function deletionAt(t: ReturnType<typeof convexTest>, phase: AccountDeletionPhase) {
  return await t.run((ctx) =>
    ctx.db.insert('accountDeletionJobs', {
      ownerId: 'alice',
      status: 'deleting',
      phase,
      attempt: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

test('deleting workspaces cannot resume crypto writes after their settings were removed', async () => {
  const t = convexTest(schema, modules);
  await deletionAt(t, 'authSessions');
  await expect(t.run((ctx) => resolveWorkspaceCryptoPolicy(ctx, 'alice'))).rejects.toThrow(
    'Account deletion is in progress',
  );
  expect(await t.run((ctx) => resolveWorkspaceCryptoPolicy(ctx, 'bob'))).toMatchObject({
    state: 'disabled',
    requiresEncryption: false,
  });
});

test('crypto grants drain in bounded resumable batches and preserve foreign workspaces', async () => {
  const t = convexTest(schema, modules);
  const jobId = await deletionAt(t, 'workspaceKeyGrantsOwned');
  const foreignId = await t.run(async (ctx) => {
    for (let index = 0; index < ACCOUNT_DELETION_BATCH_SIZE + 1; index++) {
      await ctx.db.insert('workspaceKeyGrants', {
        ...grant,
        workspaceOwnerId: 'alice',
        memberId: `member-${index}`,
      });
    }
    return ctx.db.insert('workspaceKeyGrants', {
      ...grant,
      workspaceOwnerId: 'bob',
      memberId: 'carol',
    });
  });
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  expect(await t.run((ctx) => ctx.db.query('workspaceKeyGrants').collect())).toHaveLength(2);
  expect((await t.run((ctx) => ctx.db.get(jobId)))?.phase).toBe('workspaceKeyGrantsOwned');
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  expect((await t.run((ctx) => ctx.db.get(jobId)))?.phase).toBe('workspaceKeyGrantsMemberships');
  expect(await t.run((ctx) => ctx.db.query('workspaceKeyGrants').collect())).toEqual([
    expect.objectContaining({ _id: foreignId }),
  ]);
});

test('deleting an owner cleans pending invite identities without deleting another workspace identity', async () => {
  const t = convexTest(schema, modules);
  await deletionAt(t, 'workspaceInvites');
  const { pendingIdentityId, foreignIdentityId, foreignInviteId } = await t.run(async (ctx) => {
    const inviteId = await ctx.db.insert('workspaceInvites', {
      workspaceOwnerId: 'alice',
      email: 'pending@example.com',
      emailLc: 'pending@example.com',
      token: 'pending',
      createdAt: 1,
      pendingMemberId: 'pending',
    });
    const pendingIdentityId = await ctx.db.insert('memberCryptoIdentities', {
      ...identity,
      userId: 'pending',
      inviteId,
    });
    const foreignInviteId = await ctx.db.insert('workspaceInvites', {
      workspaceOwnerId: 'bob',
      email: 'member@example.com',
      emailLc: 'member@example.com',
      token: 'foreign',
      createdAt: 1,
      pendingMemberId: 'member',
    });
    const foreignIdentityId = await ctx.db.insert('memberCryptoIdentities', {
      ...identity,
      userId: 'member',
      inviteId: foreignInviteId,
    });
    await ctx.db.insert('workspaceInvites', {
      workspaceOwnerId: 'alice',
      email: 'member@example.com',
      emailLc: 'member@example.com',
      token: 'stale',
      createdAt: 1,
      pendingMemberId: 'member',
      revokedAt: 2,
    });
    return { pendingIdentityId, foreignIdentityId, foreignInviteId };
  });
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  expect(await t.run((ctx) => ctx.db.get(pendingIdentityId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(foreignIdentityId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.query('workspaceInvites').collect())).toEqual([
    expect.objectContaining({ _id: foreignInviteId }),
  ]);
});

test('deleting a member removes pending enrollments, grants, identity and wrappers', async () => {
  const t = convexTest(schema, modules);
  const jobId = await deletionAt(t, 'workspaceInvitesPending');
  await t.run(async (ctx) => {
    const inviteId = await ctx.db.insert('workspaceInvites', {
      workspaceOwnerId: 'bob',
      email: 'alice@example.com',
      emailLc: 'alice@example.com',
      token: 'pending',
      createdAt: 1,
      pendingMemberId: 'alice',
    });
    await ctx.db.insert('memberCryptoIdentities', { ...identity, userId: 'alice', inviteId });
    await ctx.db.insert('workspaceKeyGrants', {
      ...grant,
      workspaceOwnerId: 'bob',
      memberId: 'alice',
      inviteId,
    });
    await ctx.db.insert('workspaceCryptoSettings', {
      ownerId: 'alice',
      state: 'sealed',
      recoveryProofCommitment: 'proof',
      activeKeyEpoch: 1,
      cryptoFormat: 1,
      ownerKdf: kdf,
      ownerPassphraseWrappedKey: envelope,
      ownerRecoveryWrappedKey: envelope,
      minimumClientProtocol: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  for (let batch = 0; batch < 15; batch++) {
    const job = await t.run((ctx) => ctx.db.get(jobId));
    if (job?.phase === 'daemonHeartbeats') break;
    await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  }
  expect((await t.run((ctx) => ctx.db.get(jobId)))?.phase).toBe('daemonHeartbeats');
  for (const table of [
    'workspaceInvites',
    'workspaceKeyGrants',
    'memberCryptoIdentities',
    'workspaceCryptoSettings',
  ] as const) {
    expect(await t.run((ctx) => ctx.db.query(table).collect())).toEqual([]);
  }
});

test('encrypted comment and export blobs are deleted while the workspace stays locked', async () => {
  const t = convexTest(schema, modules);
  const jobId = await deletionAt(t, 'comments');
  const { commentBlob, exportBlob } = await t.run(async (ctx) => {
    const commentBlob = await ctx.storage.store(new Blob(['encrypted comment attachment']));
    const exportBlob = await ctx.storage.store(new Blob(['encrypted export']));
    const planId = await ctx.db.insert('plans', {
      ownerId: 'bob',
      agent: 'claude',
      title: '',
      content: '',
      format: 'markdown',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const commentId = await ctx.db.insert('comments', {
      ownerId: 'bob',
      planId,
      authorId: 'alice',
      authorName: '',
      body: '',
      createdAt: 1,
      encryptedComment: envelope,
      encryptedAttachments: envelope,
      attachments: [
        {
          storageId: commentBlob,
          encrypted: true,
          contentType: 'application/octet-stream',
          size: 28,
        },
      ],
    });
    await ctx.db.insert('commentAttachmentClaims', { commentId, storageId: commentBlob });
    await ctx.db.insert('dataExports', {
      ownerId: 'alice',
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 2,
      storageId: exportBlob,
      encryptedBackup: true,
    });
    return { commentBlob, exportBlob };
  });
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  expect(await t.run((ctx) => ctx.storage.get(commentBlob))).toBeNull();
  expect(await t.run((ctx) => ctx.db.query('commentAttachmentClaims').collect())).toEqual([]);
  await t.run((ctx) => ctx.db.patch(jobId, { phase: 'dataExports' }));
  await t.mutation(internal.account.runAccountDeletionBatch, { ownerId: 'alice' });
  expect(await t.run((ctx) => ctx.storage.get(exportBlob))).toBeNull();
});
