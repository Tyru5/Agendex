import { expect, test } from 'bun:test';
import { openText, sealText, type CryptoEnvelopeV1 } from '@agendex/shared/crypto';
import { authComponent } from './auth';
import {
  auditWorkspaceCryptoRow,
  commitEncryptedAttachment,
  sealCommentsBatch,
  sealHeartbeatsBatch,
  sealPlansBatch,
  workspaceSealSnapshotDigest,
} from './workspaceCryptoSeal.ts';

const envelope = {
  v: 1,
  alg: 'xchacha20poly1305',
  keyEpoch: 2,
  nonce: new Uint8Array(24).buffer,
  ciphertext: new Uint8Array(32).buffer,
};

test('comment sealing preserves blob context across consecutive key rotations', async () => {
  type Attachment = {
    storageId: string;
    contentType: string;
    size: number;
    encrypted?: boolean;
    keyEpoch?: number;
    stableCryptoId?: string;
    fileName?: string;
  };
  const context = {
    workspaceOwnerId: 'owner-1',
    table: 'commentAttachments' as const,
    stableCryptoId: 'attachment-1',
    slot: 'attachment' as const,
  };
  const plaintext = 'Private image bytes retained through successive workspace key rotations';
  let sourceKey = new Uint8Array(32).fill(1);
  const storage = new Map<string, CryptoEnvelopeV1>([
    ['storage-1', sealText(sourceKey, plaintext, { ...context, keyEpoch: 1 })],
  ]);
  const comment = {
    _id: 'comment-1',
    ownerId: 'owner-1',
    stableCryptoId: 'comment-stable-1',
    keyEpoch: 1,
    attachments: [
      {
        storageId: 'storage-1',
        contentType: 'application/octet-stream',
        size: 100,
        encrypted: true,
        keyEpoch: 1,
        stableCryptoId: context.stableCryptoId,
        fileName: 'private-image.png',
      },
    ] as Attachment[],
  };
  const settings = {
    _id: 'settings-1',
    state: 'rotating',
    activeKeyEpoch: 2,
    operation: {
      phase: 'comments',
      kind: 'rotate',
      leaseId: 'lease-1',
      leaseExpiresAt: Date.now() + 60_000,
      processed: 0,
    },
  };
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ unique: async () => settings, first: async () => null }),
      }),
      get: async () => comment,
      patch: async (id: string, patch: Record<string, unknown>) => {
        Object.assign(id === 'comment-1' ? comment : settings, patch);
      },
    },
    storage: {
      delete: async (id: string) => {
        storage.delete(id);
      },
    },
  };
  const call = (registered: unknown, args: Record<string, unknown>) =>
    (
      registered as {
        _handler: (contextArg: typeof ctx, args: Record<string, unknown>) => Promise<void>;
      }
    )._handler(ctx, args);
  const originalGetAuthUser = authComponent.getAuthUser;
  authComponent.getAuthUser = async () =>
    ({ _id: 'owner-1' }) as Awaited<ReturnType<typeof originalGetAuthUser>>;
  try {
    for (const targetEpoch of [2, 3]) {
      settings.activeKeyEpoch = targetEpoch;
      settings.operation.phase = 'comments';
      await call(sealCommentsBatch, {
        leaseId: 'lease-1',
        continueCursor: '',
        isDone: true,
        items: [
          {
            id: comment._id,
            expectedSnapshotDigest: await workspaceSealSnapshotDigest(comment),
            stableCryptoId: comment.stableCryptoId,
            keyEpoch: targetEpoch,
            encryptedComment: { ...envelope, keyEpoch: targetEpoch },
            encryptedAttachments: { ...envelope, keyEpoch: targetEpoch },
          },
        ],
      });
      const attachment = comment.attachments[0];
      if (!attachment?.stableCryptoId || attachment.keyEpoch === undefined) {
        throw new Error('Attachment crypto context was lost');
      }
      expect(attachment.encrypted).toBe(true);
      expect(attachment.keyEpoch).toBe(targetEpoch - 1);
      expect(attachment.stableCryptoId).toBe(context.stableCryptoId);
      expect(attachment.fileName).toBeUndefined();
      const recovered = openText(sourceKey, storage.get(attachment.storageId), {
        ...context,
        stableCryptoId: attachment.stableCryptoId,
        keyEpoch: attachment.keyEpoch,
      });
      expect(recovered).toBe(plaintext);
      const targetKey = new Uint8Array(32).fill(targetEpoch);
      const nextBlob = sealText(targetKey, recovered, { ...context, keyEpoch: targetEpoch });
      const newStorageId = `storage-${targetEpoch}`;
      storage.set(newStorageId, nextBlob);
      await call(commitEncryptedAttachment, {
        leaseId: 'lease-1',
        commentId: comment._id,
        attachmentIndex: 0,
        oldStorageId: attachment.storageId,
        newStorageId,
        stableCryptoId: attachment.stableCryptoId,
        keyEpoch: targetEpoch,
        encryptedSize: nextBlob.ciphertext.byteLength,
      });
      expect(auditWorkspaceCryptoRow('comments', comment, targetEpoch)).toEqual([]);
      expect(storage.has(attachment.storageId)).toBe(false);
      sourceKey = targetKey;
    }
  } finally {
    authComponent.getAuthUser = originalGetAuthUser;
  }
});

test('rotation audit rejects old epochs and plaintext residue', () => {
  expect(
    auditWorkspaceCryptoRow(
      'tags',
      {
        keyEpoch: 2,
        stableCryptoId: 'tag-1',
        encryptedName: envelope,
        nameToken: 'opaque',
        name: '',
        nameLc: '',
      },
      2,
    ),
  ).toEqual([]);

  expect(
    auditWorkspaceCryptoRow(
      'tags',
      {
        keyEpoch: 1,
        stableCryptoId: 'tag-1',
        encryptedName: { ...envelope, keyEpoch: 1 },
        nameToken: 'opaque',
        name: 'plaintext tag',
        nameLc: 'plaintext tag',
      },
      2,
    ),
  ).toContain('old_epoch');
  expect(
    auditWorkspaceCryptoRow(
      'tags',
      {
        keyEpoch: 1,
        stableCryptoId: 'tag-1',
        encryptedName: { ...envelope, keyEpoch: 1 },
        nameToken: 'opaque',
        name: 'plaintext tag',
        nameLc: 'plaintext tag',
      },
      2,
    ),
  ).toContain('plaintext');
});

const optionalEnvelopeCases = [
  {
    table: 'collections',
    field: 'encryptedDescription',
    required: { encryptedName: envelope, nameToken: 'opaque' },
  },
  { table: 'comments', field: 'encryptedAttachments', required: { encryptedComment: envelope } },
  { table: 'daemonHeartbeats', field: 'encryptedHostname', required: {} },
  { table: 'daemonHeartbeats', field: 'encryptedIpAddress', required: {} },
] as const;

for (const { table, field, required } of optionalEnvelopeCases) {
  test(`rotation audit validates present ${table}.${field} even without associated content`, () => {
    const row = { keyEpoch: 2, stableCryptoId: 'row-1', ...required };
    expect(auditWorkspaceCryptoRow(table, row, 2)).toEqual([]);
    expect(auditWorkspaceCryptoRow(table, { ...row, [field]: envelope }, 2)).toEqual([]);
    for (const invalid of [
      { ...envelope, keyEpoch: 1 },
      { ...envelope, nonce: new Uint8Array(1).buffer },
      null,
    ]) {
      expect(auditWorkspaceCryptoRow(table, { ...row, [field]: invalid }, 2)).toEqual([
        `invalid_${field}`,
      ]);
    }
  });
}

test('rotation audit requires metadata for encrypted attachments', () => {
  const row = {
    keyEpoch: 2,
    stableCryptoId: 'comment-1',
    encryptedComment: envelope,
    attachments: [{ encrypted: true, keyEpoch: 2, contentType: 'application/octet-stream' }],
  };
  expect(auditWorkspaceCryptoRow('comments', row, 2)).toEqual(['invalid_encryptedAttachments']);
  expect(
    auditWorkspaceCryptoRow('comments', { ...row, encryptedAttachments: envelope }, 2),
  ).toEqual([]);
});

test('seal removes usage snapshots and audit rejects retained usage source paths', async () => {
  const settings = {
    _id: 'settings-1',
    state: 'sealing',
    activeKeyEpoch: 2,
    operation: {
      phase: 'daemonHeartbeats',
      kind: 'seal',
      leaseId: 'lease-1',
      leaseExpiresAt: Date.now() + 60_000,
      processed: 0,
    },
  };
  const usageSnapshots = { claude: { source: '/home/alice/private-project/session.json' } };
  const heartbeat: Record<string, unknown> = {
    _id: 'heartbeat-1',
    ownerId: 'owner-1',
    hostname: 'private-host',
    usageSnapshots,
    usageUpdatedAt: 1,
  };
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ unique: async () => settings, first: async () => null }),
      }),
      get: async () => heartbeat,
      patch: async (id: string, patch: Record<string, unknown>) => {
        if (id === 'heartbeat-1') Object.assign(heartbeat, patch);
      },
    },
  };
  const args = {
    leaseId: 'lease-1',
    continueCursor: '',
    isDone: true,
    items: [
      {
        id: 'heartbeat-1',
        expectedSnapshotDigest: await workspaceSealSnapshotDigest(heartbeat),
        stableCryptoId: 'device-1',
        keyEpoch: 2,
        encryptedHostname: envelope,
      },
    ],
  };
  const originalGetAuthUser = authComponent.getAuthUser;
  authComponent.getAuthUser = async () =>
    ({ _id: 'owner-1' }) as Awaited<ReturnType<typeof originalGetAuthUser>>;
  try {
    await (
      sealHeartbeatsBatch as unknown as {
        _handler: (context: typeof ctx, arguments_: typeof args) => Promise<void>;
      }
    )._handler(ctx, args);
  } finally {
    authComponent.getAuthUser = originalGetAuthUser;
  }
  expect(heartbeat.usageSnapshots).toBeUndefined();
  expect(heartbeat.usageUpdatedAt).toBeUndefined();
  expect(auditWorkspaceCryptoRow('daemonHeartbeats', heartbeat, 2)).toEqual([]);
  expect(auditWorkspaceCryptoRow('daemonHeartbeats', { ...heartbeat, usageSnapshots }, 2)).toEqual([
    'plaintext',
  ]);
});

test('seal removes the normalized title and audit rejects residual indexed titles', async () => {
  const settings = {
    _id: 'settings-1',
    ownerId: 'owner-1',
    state: 'sealing',
    activeKeyEpoch: 2,
    operation: {
      phase: 'plans',
      kind: 'seal',
      leaseId: 'lease-1',
      leaseExpiresAt: Date.now() + 60_000,
      processed: 0,
    },
  };
  const plan: Record<string, unknown> = {
    _id: 'plan-1',
    ownerId: 'owner-1',
    title: 'Private project',
    titleNormalized: 'private project',
    agent: 'claude',
    agentNormalized: 'claude',
    content: 'Private content',
    updatedAt: 1,
  };
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ unique: async () => settings, first: async () => null }),
      }),
      get: async () => plan,
      patch: async (id: string, patch: Record<string, unknown>) => {
        if (id === 'plan-1') Object.assign(plan, patch);
      },
    },
  };
  const args = {
    leaseId: 'lease-1',
    continueCursor: '',
    isDone: true,
    items: [
      {
        id: 'plan-1',
        expectedUpdatedAt: 1,
        expectedSnapshotDigest: await workspaceSealSnapshotDigest(plan),
        stableCryptoId: 'stable-plan-1',
        keyEpoch: 2,
        encryptedSummary: envelope,
        encryptedBody: envelope,
        contentToken: 'content-token',
        localPlanToken: 'plan-token',
        lowValue: false,
      },
    ],
  };
  const originalGetAuthUser = authComponent.getAuthUser;
  authComponent.getAuthUser = async () =>
    ({ _id: 'owner-1' }) as Awaited<ReturnType<typeof originalGetAuthUser>>;
  try {
    const handler = (
      sealPlansBatch as unknown as {
        _handler: (context: typeof ctx, arguments_: typeof args) => Promise<void>;
      }
    )._handler;
    await handler(ctx, args);
  } finally {
    authComponent.getAuthUser = originalGetAuthUser;
  }
  expect(plan.titleNormalized).toBe('');
  expect(plan.agentNormalized).toBe('claude');
  expect(auditWorkspaceCryptoRow('plans', plan, 2)).toEqual([]);
  expect(
    auditWorkspaceCryptoRow('plans', { ...plan, titleNormalized: 'private project' }, 2),
  ).toEqual(['plaintext']);
});
