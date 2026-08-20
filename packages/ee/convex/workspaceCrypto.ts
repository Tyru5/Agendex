import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { cryptoEnvelopeV1, passphraseKdfParamsV1 } from './schema';
import { hasActiveSubscription } from './subscriptions';

export const WORKSPACE_CRYPTO_PROTOCOL = 1;
export const WORKSPACE_CRYPTO_FORMAT = 1;
export const WORKSPACE_CRYPTO_MAX_CIPHERTEXT_BYTES = 768 * 1024;
export const WORKSPACE_CRYPTO_LEASE_MS = 30_000;

export type WorkspaceCryptoState =
  | 'disabled'
  | 'preparing'
  | 'sealing'
  | 'sealed'
  | 'rotating'
  | 'failed';

export type WorkspaceCryptoPolicy = {
  ownerId: string;
  state: WorkspaceCryptoState;
  requiresEncryption: boolean;
  activeKeyEpoch: number;
  minimumClientProtocol: number;
};

type DbCtx = Pick<QueryCtx | MutationCtx, 'db'>;

export async function resolveWorkspaceCryptoPolicy(
  ctx: DbCtx,
  ownerId: string,
): Promise<WorkspaceCryptoPolicy> {
  const settings = await ctx.db
    .query('workspaceCryptoSettings')
    .withIndex('by_owner', (query) => query.eq('ownerId', ownerId))
    .unique();
  if (!settings) {
    return {
      ownerId,
      state: 'disabled',
      requiresEncryption: false,
      activeKeyEpoch: 0,
      minimumClientProtocol: WORKSPACE_CRYPTO_PROTOCOL,
    };
  }
  return {
    ownerId,
    state: settings.state,
    requiresEncryption: settings.state !== 'disabled',
    activeKeyEpoch: settings.activeKeyEpoch,
    minimumClientProtocol: settings.minimumClientProtocol,
  };
}

export async function requireWorkspaceCryptoOwner(ctx: MutationCtx, ownerId?: string) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new ConvexError('Unauthenticated');
  if (ownerId !== undefined && user._id !== ownerId) throw new ConvexError('Access denied');
  return user;
}

function byteLength(value: unknown): number | null {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value instanceof Uint8Array) return value.byteLength;
  return null;
}

export function validateEnvelopeStructure(
  value: unknown,
  options: { expectedEpoch?: number; maxCiphertextBytes?: number } = {},
): void {
  if (typeof value !== 'object' || value === null)
    throw new ConvexError('Invalid encrypted payload');
  const envelope = value as Record<string, unknown>;
  if (envelope.v !== 1 || envelope.alg !== 'xchacha20poly1305') {
    throw new ConvexError('Unsupported encrypted payload');
  }
  if (!Number.isSafeInteger(envelope.keyEpoch) || Number(envelope.keyEpoch) < 1) {
    throw new ConvexError('Invalid encrypted payload epoch');
  }
  if (options.expectedEpoch !== undefined && envelope.keyEpoch !== options.expectedEpoch) {
    throw new ConvexError('Encrypted payload uses a stale key epoch');
  }
  if (byteLength(envelope.nonce) !== 24) throw new ConvexError('Invalid encrypted payload nonce');
  const ciphertextBytes = byteLength(envelope.ciphertext);
  if (ciphertextBytes === null || ciphertextBytes < 16) {
    throw new ConvexError('Invalid encrypted payload ciphertext');
  }
  if (ciphertextBytes > (options.maxCiphertextBytes ?? WORKSPACE_CRYPTO_MAX_CIPHERTEXT_BYTES)) {
    throw new ConvexError('Encrypted payload is too large');
  }
}

export function assertNoPlaintext(fields: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value.length > 0) {
      throw new ConvexError(`Plaintext ${field} is not allowed for this workspace`);
    }
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new ConvexError(`Plaintext ${field} is not allowed for this workspace`);
    }
  }
}

export function assertCurrentKeyEpoch(policy: WorkspaceCryptoPolicy, epoch: number): void {
  if (!policy.requiresEncryption) return;
  if (epoch !== policy.activeKeyEpoch)
    throw new ConvexError('Encrypted write uses a stale key epoch');
}

export function validateEncryptedWrite(args: {
  policy: WorkspaceCryptoPolicy;
  clientProtocol?: number;
  envelopes: readonly unknown[];
  plaintext: Record<string, unknown>;
}): void {
  if (!args.policy.requiresEncryption) return;
  requireSupportedCryptoClient(args.policy, args.clientProtocol);
  if (args.envelopes.length === 0) throw new ConvexError('Encrypted payload is required');
  for (const envelope of args.envelopes) {
    validateEnvelopeStructure(envelope, { expectedEpoch: args.policy.activeKeyEpoch });
  }
  assertNoPlaintext(args.plaintext);
}

export function requireSupportedCryptoClient(
  policy: WorkspaceCryptoPolicy,
  clientProtocol?: number,
): void {
  if (!policy.requiresEncryption) return;
  if (
    !Number.isSafeInteger(clientProtocol) ||
    Number(clientProtocol) < policy.minimumClientProtocol
  ) {
    throw new ConvexError('This client must be upgraded before writing to this workspace');
  }
}

export function canReadLegacyDuringSeal(policy: WorkspaceCryptoPolicy): boolean {
  return policy.state === 'disabled' || policy.state === 'preparing' || policy.state === 'sealing';
}

const ALLOWED_TRANSITIONS: Record<WorkspaceCryptoState, readonly WorkspaceCryptoState[]> = {
  disabled: ['preparing'],
  preparing: ['sealing'],
  sealing: ['sealed', 'failed'],
  sealed: ['rotating'],
  rotating: ['sealed', 'failed'],
  failed: ['sealing', 'rotating'],
};

export function assertWorkspaceCryptoTransition(
  from: WorkspaceCryptoState,
  to: WorkspaceCryptoState,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ConvexError(`Invalid Obfuscation transition: ${from} to ${to}`);
  }
}

export function sanitizeWorkspaceCryptoError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/passphrase|secret|ciphertext|plaintext|key material/i.test(message)) {
    return 'Obfuscation operation failed';
  }
  return message.slice(0, 240);
}

export function workspaceCryptoRolloutAllows(ownerId: string, value?: string): boolean {
  const rollout = (value ?? process.env.OBFUSCATION_ROLLOUT ?? '').trim();
  if (rollout === 'all') return true;
  return rollout
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(ownerId);
}

export function workspaceCryptoTeamRolloutAllows(ownerId: string, value?: string): boolean {
  const rollout = (value ?? process.env.OBFUSCATION_TEAM_ROLLOUT ?? '').trim();
  if (rollout === 'all') return true;
  return rollout
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(ownerId);
}

export function assertCompleteRotationGrantSet(
  expectedMemberIds: readonly string[],
  suppliedMemberIds: readonly string[],
): void {
  const expected = new Set(expectedMemberIds);
  const supplied = new Set(suppliedMemberIds);
  if (
    suppliedMemberIds.length !== expected.size ||
    supplied.size !== expected.size ||
    suppliedMemberIds.some((memberId) => !expected.has(memberId))
  ) {
    throw new ConvexError('Every remaining member needs a new workspace key grant');
  }
}

type ServerPassphraseKdf =
  | {
      alg: 'scrypt';
      salt: ArrayBuffer;
      N: number;
      r: number;
      p: number;
      dkLen: 32;
      maxmem: number;
    }
  | {
      alg: 'argon2id';
      salt: ArrayBuffer;
      memorySize: number;
      iterations: number;
      parallelism: number;
      dkLen: 32;
    };

export function assertKdfParams(value: ServerPassphraseKdf): void {
  if (value.salt.byteLength !== 16) throw new ConvexError('Invalid KDF salt');
  if (value.dkLen !== 32) throw new ConvexError('Invalid KDF key length');
  if (value.alg === 'argon2id') {
    if (
      !Number.isSafeInteger(value.memorySize) ||
      value.memorySize < 19 * 1024 ||
      value.memorySize > 256 * 1024 ||
      !Number.isSafeInteger(value.iterations) ||
      value.iterations < 2 ||
      value.iterations > 20 ||
      !Number.isSafeInteger(value.parallelism) ||
      value.parallelism < 1 ||
      value.parallelism > 4 ||
      value.memorySize * value.iterations > 1024 * 1024
    ) {
      throw new ConvexError('Unsupported KDF resource cost');
    }
    return;
  }
  if (!Number.isSafeInteger(value.N) || !Number.isInteger(Math.log2(value.N))) {
    throw new ConvexError('Invalid KDF work factor');
  }
  if (value.N < 2 ** 14 || value.N > 2 ** 20) throw new ConvexError('Unsupported KDF work factor');
  if (!Number.isSafeInteger(value.r) || value.r < 1 || value.r > 32) {
    throw new ConvexError('Invalid KDF block size');
  }
  if (!Number.isSafeInteger(value.p) || value.p < 1 || value.p > 16) {
    throw new ConvexError('Invalid KDF parallelization');
  }
  if (!Number.isSafeInteger(value.maxmem) || value.maxmem < 16 * 1024 * 1024) {
    throw new ConvexError('Invalid KDF memory limit');
  }
  if (
    value.N > 2 ** 18 ||
    value.r > 16 ||
    value.p > 4 ||
    value.N * value.r > 2 ** 21 ||
    value.N * value.r * value.p > 2 ** 22 ||
    value.maxmem > 512 * 1024 * 1024
  ) {
    throw new ConvexError('Unsupported KDF resource cost');
  }
  const requiredMemory = 128 * value.N * value.r + 128 * value.r * value.p + 256 * value.r;
  if (requiredMemory > value.maxmem) {
    throw new ConvexError('KDF memory limit is below its required work area');
  }
}

async function workspaceBlockers(ctx: DbCtx, ownerId: string) {
  const member = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_workspace', (lookup) => lookup.eq('workspaceOwnerId', ownerId))
    .first();
  const invite = (
    await ctx.db
      .query('workspaceInvites')
      .withIndex('by_workspace', (lookup) => lookup.eq('workspaceOwnerId', ownerId))
      .take(20)
  ).find((candidate) => !candidate.acceptedAt && !candidate.revokedAt);
  return { hasMembers: member !== null, hasPendingInvites: invite !== undefined };
}

export const getWorkspaceCryptoStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    let role: 'owner' | 'member' = 'owner';
    let workspaceOwnerId: string = user._id;
    let settings = await ctx.db
      .query('workspaceCryptoSettings')
      .withIndex('by_owner', (lookup) => lookup.eq('ownerId', user._id))
      .unique();

    if (!settings) {
      const membership = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_member', (lookup) => lookup.eq('memberId', user._id))
        .first();
      if (membership) {
        role = 'member';
        workspaceOwnerId = membership.workspaceOwnerId;
        settings = await ctx.db
          .query('workspaceCryptoSettings')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', workspaceOwnerId))
          .unique();
      }
    }

    const ownPro = role === 'owner' ? await hasActiveSubscription(ctx) : false;
    const rolloutAvailable = role === 'owner' && workspaceCryptoRolloutAllows(workspaceOwnerId);
    const blockers = role === 'owner' ? await workspaceBlockers(ctx, workspaceOwnerId) : null;
    const visible = settings !== null || (ownPro && rolloutAvailable);

    return {
      visible,
      role,
      workspaceOwnerId,
      rolloutAvailable,
      blockers,
      settings: settings
        ? {
            state: settings.state,
            requestedAt: settings.requestedAt,
            enabledAt: settings.enabledAt,
            recoveryVerifiedAt: settings.recoveryVerifiedAt,
            activeKeyEpoch: settings.activeKeyEpoch,
            cryptoFormat: settings.cryptoFormat,
            minimumClientProtocol: settings.minimumClientProtocol,
            operation: settings.operation,
            ownerKdf: role === 'owner' ? settings.ownerKdf : undefined,
            ownerPassphraseWrappedKey:
              role === 'owner' ? settings.ownerPassphraseWrappedKey : undefined,
            previousKeyEpoch: role === 'owner' ? settings.previousKeyEpoch : undefined,
            previousOwnerKdf: role === 'owner' ? settings.previousOwnerKdf : undefined,
            previousOwnerPassphraseWrappedKey:
              role === 'owner' ? settings.previousOwnerPassphraseWrappedKey : undefined,
          }
        : null,
    };
  },
});

export const startWorkspaceSeal = mutation({
  args: {
    confirmedEmail: v.string(),
    clientProtocol: v.number(),
    operationId: v.string(),
    leaseId: v.string(),
    ownerKdf: passphraseKdfParamsV1,
    ownerPassphraseWrappedKey: cryptoEnvelopeV1,
    ownerRecoveryWrappedKey: cryptoEnvelopeV1,
    recoveryProofCommitment: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireWorkspaceCryptoOwner(ctx);
    await requireFeature(ctx, ProFeature.CLOUD_SYNC);
    if (!workspaceCryptoRolloutAllows(user._id)) {
      throw new ConvexError('Obfuscation is not available for this workspace yet');
    }
    if (!user.email || args.confirmedEmail !== user.email) {
      throw new ConvexError('Email confirmation does not match');
    }
    if (args.clientProtocol < WORKSPACE_CRYPTO_PROTOCOL) {
      throw new ConvexError('This client must be upgraded before enabling Obfuscation');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(args.recoveryProofCommitment)) {
      throw new ConvexError('Invalid recovery verification proof');
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(args.operationId) || args.leaseId.length < 16) {
      throw new ConvexError('Invalid seal operation identity');
    }
    const existing = await ctx.db
      .query('workspaceCryptoSettings')
      .withIndex('by_owner', (lookup) => lookup.eq('ownerId', user._id))
      .unique();
    if (existing) throw new ConvexError('Obfuscation setup has already started');

    const blockers = await workspaceBlockers(ctx, user._id);
    if (blockers.hasMembers || blockers.hasPendingInvites) {
      throw new ConvexError('Remove workspace members and pending invitations before enabling');
    }

    assertKdfParams(args.ownerKdf);
    validateEnvelopeStructure(args.ownerPassphraseWrappedKey, {
      expectedEpoch: 1,
      maxCiphertextBytes: 64,
    });
    validateEnvelopeStructure(args.ownerRecoveryWrappedKey, {
      expectedEpoch: 1,
      maxCiphertextBytes: 64,
    });

    const now = Date.now();
    await ctx.db.insert('workspaceCryptoSettings', {
      ownerId: user._id,
      state: 'sealing',
      requestedAt: now,
      recoveryVerifiedAt: now,
      recoveryProofCommitment: args.recoveryProofCommitment,
      activeKeyEpoch: 1,
      cryptoFormat: 1,
      ownerKdf: args.ownerKdf,
      ownerPassphraseWrappedKey: args.ownerPassphraseWrappedKey,
      ownerRecoveryWrappedKey: args.ownerRecoveryWrappedKey,
      minimumClientProtocol: WORKSPACE_CRYPTO_PROTOCOL,
      operation: {
        id: args.operationId,
        kind: 'seal',
        phase: 'plans',
        processed: 0,
        leaseId: args.leaseId,
        leaseExpiresAt: now + WORKSPACE_CRYPTO_LEASE_MS,
        heartbeatAt: now,
        startedAt: now,
        updatedAt: now,
        targetEpoch: 1,
      },
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const startWorkspaceRotation = mutation({
  args: {
    membershipId: v.id('workspaceMembers'),
    clientProtocol: v.number(),
    operationId: v.string(),
    leaseId: v.string(),
    ownerKdf: passphraseKdfParamsV1,
    ownerPassphraseWrappedKey: cryptoEnvelopeV1,
    ownerRecoveryWrappedKey: cryptoEnvelopeV1,
    recoveryProofCommitment: v.string(),
    grants: v.array(
      v.object({
        memberId: v.string(),
        kem: v.literal('DHKEM(X25519, HKDF-SHA256)'),
        kdf: v.literal('HKDF-SHA256'),
        aead: v.literal('ChaCha20Poly1305'),
        encapsulatedKey: v.bytes(),
        ciphertext: v.bytes(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireWorkspaceCryptoOwner(ctx);
    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);
    const settings = await ctx.db
      .query('workspaceCryptoSettings')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .unique();
    if (!settings || settings.state !== 'sealed' || settings.operation) {
      throw new ConvexError('Workspace is not ready for key rotation');
    }
    requireSupportedCryptoClient(
      {
        ownerId: user._id,
        state: settings.state,
        requiresEncryption: true,
        activeKeyEpoch: settings.activeKeyEpoch,
        minimumClientProtocol: settings.minimumClientProtocol,
      },
      args.clientProtocol,
    );
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.workspaceOwnerId !== user._id) {
      throw new ConvexError('Membership not found');
    }
    const nextEpoch = settings.activeKeyEpoch + 1;
    assertKdfParams(args.ownerKdf);
    validateEnvelopeStructure(args.ownerPassphraseWrappedKey, {
      expectedEpoch: nextEpoch,
      maxCiphertextBytes: 64,
    });
    validateEnvelopeStructure(args.ownerRecoveryWrappedKey, {
      expectedEpoch: nextEpoch,
      maxCiphertextBytes: 64,
    });
    const remainingMembers = (
      await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
        .collect()
    ).filter((member) => member._id !== membership._id);
    assertCompleteRotationGrantSet(
      remainingMembers.map((member) => member.memberId),
      args.grants.map((grant) => grant.memberId),
    );
    const now = Date.now();
    for (const grant of args.grants) {
      if (grant.encapsulatedKey.byteLength !== 32 || grant.ciphertext.byteLength < 48) {
        throw new ConvexError('Invalid workspace key grant');
      }
      await ctx.db.insert('workspaceKeyGrants', {
        workspaceOwnerId: user._id,
        memberId: grant.memberId,
        keyEpoch: nextEpoch,
        kem: grant.kem,
        kdf: grant.kdf,
        aead: grant.aead,
        encapsulatedKey: grant.encapsulatedKey,
        ciphertext: grant.ciphertext,
        createdAt: now,
      });
    }
    const removedGrants = await ctx.db
      .query('workspaceKeyGrants')
      .withIndex('by_workspace_member', (q) =>
        q.eq('workspaceOwnerId', user._id).eq('memberId', membership.memberId),
      )
      .collect();
    for (const grant of removedGrants) await ctx.db.patch(grant._id, { revokedAt: now });
    const removedIdentity = await ctx.db
      .query('memberCryptoIdentities')
      .withIndex('by_user', (q) => q.eq('userId', membership.memberId))
      .first();
    if (removedIdentity) await ctx.db.delete(removedIdentity._id);
    await ctx.db.delete(membership._id);
    await ctx.db.patch(settings._id, {
      state: 'rotating',
      activeKeyEpoch: nextEpoch,
      previousKeyEpoch: settings.activeKeyEpoch,
      previousOwnerKdf: settings.ownerKdf,
      previousOwnerPassphraseWrappedKey: settings.ownerPassphraseWrappedKey,
      previousOwnerRecoveryWrappedKey: settings.ownerRecoveryWrappedKey,
      ownerKdf: args.ownerKdf,
      ownerPassphraseWrappedKey: args.ownerPassphraseWrappedKey,
      ownerRecoveryWrappedKey: args.ownerRecoveryWrappedKey,
      recoveryProofCommitment: args.recoveryProofCommitment,
      recoveryVerifiedAt: now,
      operation: {
        id: args.operationId,
        kind: 'rotate',
        phase: 'plans',
        processed: 0,
        leaseId: args.leaseId,
        leaseExpiresAt: now + WORKSPACE_CRYPTO_LEASE_MS,
        heartbeatAt: now,
        startedAt: now,
        updatedAt: now,
        fromEpoch: settings.activeKeyEpoch,
        targetEpoch: nextEpoch,
      },
      updatedAt: now,
    });
  },
});

export const claimWorkspaceCryptoLease = mutation({
  args: { operationId: v.string(), leaseId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireWorkspaceCryptoOwner(ctx);
    const settings = await ctx.db
      .query('workspaceCryptoSettings')
      .withIndex('by_owner', (lookup) => lookup.eq('ownerId', user._id))
      .unique();
    if (!settings?.operation || settings.operation.id !== args.operationId) {
      throw new ConvexError('Obfuscation operation not found');
    }
    const now = Date.now();
    if (
      settings.operation.leaseId &&
      settings.operation.leaseId !== args.leaseId &&
      (settings.operation.leaseExpiresAt ?? 0) > now
    ) {
      throw new ConvexError('Another device is sealing this workspace');
    }
    await ctx.db.patch(settings._id, {
      operation: {
        ...settings.operation,
        leaseId: args.leaseId,
        leaseExpiresAt: now + WORKSPACE_CRYPTO_LEASE_MS,
        heartbeatAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    });
  },
});

export const heartbeatWorkspaceCryptoLease = mutation({
  args: { operationId: v.string(), leaseId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireWorkspaceCryptoOwner(ctx);
    const settings = await ctx.db
      .query('workspaceCryptoSettings')
      .withIndex('by_owner', (lookup) => lookup.eq('ownerId', user._id))
      .unique();
    if (
      !settings?.operation ||
      settings.operation.id !== args.operationId ||
      settings.operation.leaseId !== args.leaseId
    ) {
      throw new ConvexError('Obfuscation lease was lost');
    }
    const now = Date.now();
    await ctx.db.patch(settings._id, {
      operation: {
        ...settings.operation,
        leaseExpiresAt: now + WORKSPACE_CRYPTO_LEASE_MS,
        heartbeatAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    });
  },
});
