import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { hasActiveSubscriptionForUserId } from './subscriptions';
import { cryptoEnvelopeV1, passphraseKdfParamsV1 } from './schema';
import {
  assertKdfParams,
  resolveWorkspaceCryptoPolicy,
  validateEncryptedWrite,
  validateEnvelopeStructure,
  workspaceCryptoTeamRolloutAllows,
} from './workspaceCrypto';

const SEAT_LIMIT = 5;

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export const listWorkspaceMembers = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
      .collect();

    const pendingInvites = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
        .collect()
    ).filter((inv) => !inv.acceptedAt && !inv.revokedAt);

    const usedSeats = 1 + members.length + pendingInvites.length;
    const cryptoPolicy = await resolveWorkspaceCryptoPolicy(ctx, user._id);

    return {
      members,
      pendingInvites,
      seatLimit: SEAT_LIMIT,
      usedSeats,
      remainingSeats: Math.max(0, SEAT_LIMIT - usedSeats),
      teamEnrollmentAvailable:
        !cryptoPolicy.requiresEncryption || workspaceCryptoTeamRolloutAllows(user._id),
    };
  },
});

export const inviteWorkspaceMember = mutation({
  args: {
    email: v.string(),
    token: v.optional(v.string()),
    clientCryptoProtocol: v.optional(v.number()),
    inviteSecretCommitment: v.optional(v.string()),
    encryptedInviteSecret: v.optional(cryptoEnvelopeV1),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const cryptoPolicy = await resolveWorkspaceCryptoPolicy(ctx, user._id);
    if (cryptoPolicy.requiresEncryption) {
      if (!workspaceCryptoTeamRolloutAllows(user._id)) {
        throw new ConvexError('Encrypted team enrollment is not enabled for this workspace yet');
      }
      validateEncryptedWrite({
        policy: cryptoPolicy,
        clientProtocol: args.clientCryptoProtocol,
        envelopes: args.encryptedInviteSecret ? [args.encryptedInviteSecret] : [],
        plaintext: {},
      });
      if (
        !args.token ||
        !/^[A-Za-z0-9_-]{22,128}$/.test(args.token) ||
        !args.inviteSecretCommitment ||
        !/^[A-Za-z0-9_-]{43}$/.test(args.inviteSecretCommitment)
      ) {
        throw new ConvexError('Encrypted invitation metadata is required');
      }
    }

    const emailLc = args.email.trim().toLowerCase();
    if (!emailLc) throw new ConvexError('Email cannot be empty');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLc)) throw new ConvexError('Invalid email address');

    if (user.email && user.email.toLowerCase() === emailLc) {
      throw new ConvexError('You cannot invite yourself');
    }

    const existingMember = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace_emailLc', (q) =>
        q.eq('workspaceOwnerId', user._id).eq('emailLc', emailLc),
      )
      .first();

    if (existingMember) throw new ConvexError('This email is already a workspace member');

    const existingInvite = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace_emailLc', (q) =>
          q.eq('workspaceOwnerId', user._id).eq('emailLc', emailLc),
        )
        .collect()
    ).find((inv) => !inv.acceptedAt && !inv.revokedAt);

    if (existingInvite) throw new ConvexError('An invite for this email is already pending');

    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
      .collect();

    const pendingInvites = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
        .collect()
    ).filter((inv) => !inv.acceptedAt && !inv.revokedAt);

    if (members.length + pendingInvites.length >= SEAT_LIMIT - 1) {
      throw new ConvexError('Workspace seat limit reached');
    }

    const token = cryptoPolicy.requiresEncryption ? args.token : crypto.randomUUID();
    if (!token) throw new ConvexError('Encrypted invitation token is required');
    const tokenCollision = await ctx.db
      .query('workspaceInvites')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first();
    if (tokenCollision) throw new ConvexError('Invite token collision');

    await ctx.db.insert('workspaceInvites', {
      workspaceOwnerId: user._id,
      email: args.email.trim(),
      emailLc,
      token,
      createdAt: Date.now(),
      ...(cryptoPolicy.requiresEncryption
        ? {
            inviteSecretCommitment: args.inviteSecretCommitment,
            encryptedInviteSecret: args.encryptedInviteSecret,
            cryptoProtocol: args.clientCryptoProtocol,
          }
        : {}),
    });

    return { token };
  },
});

export const revokeWorkspaceInvite = mutation({
  args: { inviteId: v.id('workspaceInvites') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new ConvexError('Invite not found');

    if (invite.workspaceOwnerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    if (invite.pendingMemberId) {
      const pendingMemberId = invite.pendingMemberId;
      const identity = await ctx.db
        .query('memberCryptoIdentities')
        .withIndex('by_user', (q) => q.eq('userId', pendingMemberId))
        .first();
      if (identity?.inviteId === invite._id) await ctx.db.delete(identity._id);
    }
    await ctx.db.patch(args.inviteId, { revokedAt: Date.now() });
  },
});

export const removeWorkspaceMember = mutation({
  args: { membershipId: v.id('workspaceMembers') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new ConvexError('Membership not found');

    if (membership.workspaceOwnerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    if (membership.memberId === user._id) {
      throw new ConvexError('You cannot remove yourself');
    }

    const cryptoPolicy = await resolveWorkspaceCryptoPolicy(ctx, membership.workspaceOwnerId);
    if (cryptoPolicy.requiresEncryption) {
      throw new ConvexError('Unlock Obfuscation and rotate keys before removing this member');
    }

    await ctx.db.delete(args.membershipId);
  },
});

export const getWorkspaceInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query('workspaceInvites')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!invite) {
      return { status: 'not_found' as const };
    }

    if (invite.revokedAt) {
      return { status: 'revoked' as const };
    }

    if (invite.acceptedAt) {
      return { status: 'accepted' as const };
    }

    return {
      status: 'valid' as const,
      email: invite.email,
      workspaceOwnerId: invite.workspaceOwnerId,
      encrypted: Boolean(invite.encryptedInviteSecret),
      cryptoProtocol: invite.cryptoProtocol,
    };
  },
});

export const acceptWorkspaceInvite = mutation({
  args: {
    token: v.string(),
    memberPublicKey: v.optional(v.bytes()),
    enrollmentProof: v.optional(v.string()),
    encryptedPrivateKey: v.optional(cryptoEnvelopeV1),
    recoveryWrappedPrivateKey: v.optional(cryptoEnvelopeV1),
    kdf: v.optional(passphraseKdfParamsV1),
    keyVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const invite = await ctx.db
      .query('workspaceInvites')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!invite) throw new ConvexError('Invite not found');
    if (invite.revokedAt) throw new ConvexError('This invite has been revoked');
    if (invite.acceptedAt) throw new ConvexError('This invite has already been accepted');

    const ownerActive = await hasActiveSubscriptionForUserId(ctx, invite.workspaceOwnerId);
    if (!ownerActive) {
      throw new ConvexError('The workspace owner does not have an active subscription');
    }

    const cryptoPolicy = await resolveWorkspaceCryptoPolicy(ctx, invite.workspaceOwnerId);
    if (!user.email || user.email.toLowerCase() !== invite.emailLc) {
      throw new ConvexError('This invite was sent to a different email address');
    }

    const existingMembership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_member', (q) => q.eq('memberId', user._id))
      .first();

    if (existingMembership) {
      throw new ConvexError('You are already a member of a workspace');
    }

    if (cryptoPolicy.requiresEncryption) {
      if (
        !invite.encryptedInviteSecret ||
        !args.memberPublicKey ||
        args.memberPublicKey.byteLength !== 32 ||
        !args.enrollmentProof ||
        !/^[A-Za-z0-9_-]{43}$/.test(args.enrollmentProof) ||
        !args.encryptedPrivateKey ||
        !args.recoveryWrappedPrivateKey ||
        !args.kdf ||
        args.keyVersion !== 1
      ) {
        throw new ConvexError('The full encrypted invite and member key setup are required');
      }
      assertKdfParams(args.kdf);
      validateEnvelopeStructure(args.encryptedPrivateKey, {
        expectedEpoch: args.keyVersion,
        maxCiphertextBytes: 128,
      });
      validateEnvelopeStructure(args.recoveryWrappedPrivateKey, {
        expectedEpoch: args.keyVersion,
        maxCiphertextBytes: 128,
      });
      const existingIdentity = await ctx.db
        .query('memberCryptoIdentities')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .first();
      if (existingIdentity) {
        if (
          invite.pendingMemberId === user._id &&
          existingIdentity.inviteId === invite._id &&
          equalBytes(existingIdentity.publicKey, args.memberPublicKey)
        ) {
          return { pendingApproval: true as const };
        }
        throw new ConvexError('A member encryption identity already exists');
      }
      const now = Date.now();
      await ctx.db.insert('memberCryptoIdentities', {
        userId: user._id,
        publicKey: args.memberPublicKey,
        encryptedPrivateKey: args.encryptedPrivateKey,
        recoveryWrappedPrivateKey: args.recoveryWrappedPrivateKey,
        kdf: args.kdf,
        keyVersion: args.keyVersion,
        inviteId: invite._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(invite._id, {
        pendingMemberId: user._id,
        memberPublicKey: args.memberPublicKey,
        enrollmentProof: args.enrollmentProof,
        approvalRequestedAt: now,
      });
      return { pendingApproval: true as const };
    }

    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', invite.workspaceOwnerId))
      .collect();

    const pendingInvites = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', invite.workspaceOwnerId))
        .collect()
    ).filter((inv) => !inv.acceptedAt && !inv.revokedAt && inv._id !== invite._id);

    if (1 + members.length + pendingInvites.length >= SEAT_LIMIT) {
      throw new ConvexError('Workspace is full');
    }

    await ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: invite.workspaceOwnerId,
      memberId: user._id,
      email: invite.email,
      emailLc: invite.emailLc,
      role: 'member',
      addedAt: Date.now(),
    });

    await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
    return { pendingApproval: false as const };
  },
});

export const approveEncryptedWorkspaceInvite = mutation({
  args: {
    inviteId: v.id('workspaceInvites'),
    keyEpoch: v.number(),
    kem: v.literal('DHKEM(X25519, HKDF-SHA256)'),
    kdf: v.literal('HKDF-SHA256'),
    aead: v.literal('ChaCha20Poly1305'),
    encapsulatedKey: v.bytes(),
    ciphertext: v.bytes(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.workspaceOwnerId !== user._id) throw new ConvexError('Invite not found');
    if (
      invite.revokedAt ||
      invite.acceptedAt ||
      !invite.pendingMemberId ||
      !invite.memberPublicKey ||
      !invite.enrollmentProof
    ) {
      throw new ConvexError('Invite is not awaiting encrypted approval');
    }
    const pendingMemberId = invite.pendingMemberId;
    const memberPublicKey = invite.memberPublicKey;
    const policy = await resolveWorkspaceCryptoPolicy(ctx, user._id);
    if (!policy.requiresEncryption || args.keyEpoch !== policy.activeKeyEpoch) {
      throw new ConvexError('Workspace key epoch changed before approval');
    }
    if (args.encapsulatedKey.byteLength !== 32 || args.ciphertext.byteLength < 48) {
      throw new ConvexError('Invalid workspace key grant');
    }
    const identity = await ctx.db
      .query('memberCryptoIdentities')
      .withIndex('by_user', (q) => q.eq('userId', pendingMemberId))
      .first();
    if (!identity || !equalBytes(identity.publicKey, memberPublicKey)) {
      throw new ConvexError('Member encryption identity changed');
    }
    const now = Date.now();
    await ctx.db.insert('workspaceKeyGrants', {
      workspaceOwnerId: user._id,
      memberId: pendingMemberId,
      keyEpoch: args.keyEpoch,
      kem: args.kem,
      kdf: args.kdf,
      aead: args.aead,
      encapsulatedKey: args.encapsulatedKey,
      ciphertext: args.ciphertext,
      inviteId: invite._id,
      createdAt: now,
    });
    await ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: user._id,
      memberId: pendingMemberId,
      email: invite.email,
      emailLc: invite.emailLc,
      role: 'member',
      addedAt: now,
    });
    await ctx.db.patch(invite._id, { acceptedAt: now, approvedAt: now });
  },
});

export const getMemberCryptoUnlockMaterial = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return null;
    const membership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_member', (q) => q.eq('memberId', user._id))
      .first();
    if (!membership) return null;
    const settings = await ctx.db
      .query('workspaceCryptoSettings')
      .withIndex('by_owner', (q) => q.eq('ownerId', membership.workspaceOwnerId))
      .unique();
    if (!settings || settings.state === 'disabled') return null;
    const identity = await ctx.db
      .query('memberCryptoIdentities')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first();
    const grant = await ctx.db
      .query('workspaceKeyGrants')
      .withIndex('by_workspace_member_epoch', (q) =>
        q
          .eq('workspaceOwnerId', membership.workspaceOwnerId)
          .eq('memberId', user._id)
          .eq('keyEpoch', settings.activeKeyEpoch),
      )
      .first();
    if (!identity || !grant || grant.revokedAt) return null;
    return {
      workspaceOwnerId: membership.workspaceOwnerId,
      memberId: user._id,
      activeKeyEpoch: settings.activeKeyEpoch,
      identity: {
        encryptedPrivateKey: identity.encryptedPrivateKey,
        recoveryWrappedPrivateKey: identity.recoveryWrappedPrivateKey,
        kdf: identity.kdf,
        keyVersion: identity.keyVersion,
      },
      grant: {
        kem: grant.kem,
        kdf: grant.kdf,
        aead: grant.aead,
        encapsulatedKey: grant.encapsulatedKey,
        ciphertext: grant.ciphertext,
      },
    };
  },
});

export const getRotationRecipients = query({
  args: { membershipId: v.id('workspaceMembers') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    const removed = await ctx.db.get(args.membershipId);
    if (!removed || removed.workspaceOwnerId !== user._id)
      throw new ConvexError('Member not found');
    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
      .collect();
    return await Promise.all(
      members
        .filter((member) => member._id !== removed._id)
        .map(async (member) => {
          const identity = await ctx.db
            .query('memberCryptoIdentities')
            .withIndex('by_user', (q) => q.eq('userId', member.memberId))
            .first();
          if (!identity || identity.revokedAt)
            throw new ConvexError('Member identity is unavailable');
          return { memberId: member.memberId, publicKey: identity.publicKey };
        }),
    );
  },
});
