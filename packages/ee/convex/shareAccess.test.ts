import { describe, expect, test } from 'bun:test';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { evaluateShareAccessPolicy, requireSharedPlanAccess } from './shareAccess';

const shareLinkId = 'share-link-a' as Id<'shareLinks'>;
const otherShareLinkId = 'share-link-b' as Id<'shareLinks'>;

const planId = 'plan-a' as Id<'plans'>;
const proofId = 'proof-a' as Id<'shareAccessProofs'>;

const plan = {
  _id: planId,
  _creationTime: 1,
  ownerId: 'owner-a',
  agent: 'claude',
  title: 'Secure shared-plan access',
  content:
    '# Secure sharing\n\n## Approach\nIssue a short-lived proof after password verification.\n\n## Steps\n- Bind the proof to one share link.\n- Verify it for every protected shared resource.\n- Reject expired and revoked credentials.',
  format: 'markdown',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
} satisfies Doc<'plans'>;

function createShareAccessCtx({
  protectedLink,
  revoked = false,
  proof,
}: {
  protectedLink: boolean;
  revoked?: boolean;
  proof?: Doc<'shareAccessProofs'>;
}): Pick<QueryCtx, 'db'> {
  const shareLink = revoked
    ? null
    : ({
        _id: shareLinkId,
        _creationTime: 1,
        planId,
        token: 'raw-token',
        createdBy: 'owner-a',
        createdAt: 1,
        ...(protectedLink ? { passwordHash: 'stored-password-hash' } : {}),
      } satisfies Doc<'shareLinks'>);

  return {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => shareLink,
        }),
      }),
      get: async (id: string) => {
        if (id === planId) return plan;
        if (proof && id === proof._id) return proof;
        return null;
      },
    } as unknown as QueryCtx['db'],
  };
}

describe('share access policy', () => {
  test('unprotected links accept the raw share token without an access proof', () => {
    expect(
      evaluateShareAccessPolicy({
        shareLinkId,
        passwordProtected: false,
        accessProof: null,
        now: 1_000,
      }),
    ).toEqual({ kind: 'authorized' });
  });

  test('protected links require a proof bound to the same share link', () => {
    expect(
      evaluateShareAccessPolicy({
        shareLinkId,
        passwordProtected: true,
        accessProof: null,
        now: 1_000,
      }),
    ).toEqual({ kind: 'password_required', reason: 'missing' });

    expect(
      evaluateShareAccessPolicy({
        shareLinkId,
        passwordProtected: true,
        accessProof: { shareLinkId: otherShareLinkId, expiresAt: 2_000 },
        now: 1_000,
      }),
    ).toEqual({ kind: 'password_required', reason: 'invalid' });

    expect(
      evaluateShareAccessPolicy({
        shareLinkId,
        passwordProtected: true,
        accessProof: { shareLinkId, expiresAt: 2_000 },
        now: 1_000,
      }),
    ).toEqual({ kind: 'authorized' });
  });

  test('protected-link proofs stop authorizing at their expiry boundary', () => {
    expect(
      evaluateShareAccessPolicy({
        shareLinkId,
        passwordProtected: true,
        accessProof: { shareLinkId, expiresAt: 2_000 },
        now: 2_000,
      }),
    ).toEqual({ kind: 'password_required', reason: 'expired' });
  });

  test('revoked links deny access even when an otherwise valid proof remains', () => {
    expect(
      evaluateShareAccessPolicy({
        shareLinkId: null,
        passwordProtected: true,
        accessProof: { shareLinkId, expiresAt: 2_000 },
        now: 1_000,
      }),
    ).toEqual({ kind: 'denied', reason: 'revoked' });
  });
});

describe('central shared-resource authorization', () => {
  test('raw tokens continue to authorize unprotected shared resources', async () => {
    const result = await requireSharedPlanAccess(createShareAccessCtx({ protectedLink: false }), {
      token: 'raw-token',
      planId,
    });
    expect(result.plan._id).toBe(planId);
  });

  test('raw tokens alone cannot authorize protected shared resources', async () => {
    await expect(
      requireSharedPlanAccess(createShareAccessCtx({ protectedLink: true }), {
        token: 'raw-token',
        planId,
      }),
    ).rejects.toThrow('Share access proof required');
  });

  test('a live proof authorizes only the protected link it is bound to', async () => {
    const proof = {
      _id: proofId,
      _creationTime: 1,
      shareLinkId,
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
    } satisfies Doc<'shareAccessProofs'>;

    const result = await requireSharedPlanAccess(
      createShareAccessCtx({ protectedLink: true, proof }),
      { token: 'raw-token', planId, accessProof: proofId },
    );
    expect(result.shareLink._id).toBe(shareLinkId);
  });

  test('expired proofs cannot authorize protected shared resources', async () => {
    const proof = {
      _id: proofId,
      _creationTime: 1,
      shareLinkId,
      createdAt: 1,
      expiresAt: 0,
    } satisfies Doc<'shareAccessProofs'>;

    await expect(
      requireSharedPlanAccess(createShareAccessCtx({ protectedLink: true, proof }), {
        token: 'raw-token',
        planId,
        accessProof: proofId,
      }),
    ).rejects.toThrow('Share access proof expired');
  });

  test('revoked links invalidate still-live proofs', async () => {
    const proof = {
      _id: proofId,
      _creationTime: 1,
      shareLinkId,
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
    } satisfies Doc<'shareAccessProofs'>;

    await expect(
      requireSharedPlanAccess(createShareAccessCtx({ protectedLink: true, revoked: true, proof }), {
        token: 'raw-token',
        planId,
        accessProof: proofId,
      }),
    ).rejects.toThrow('Invalid or revoked share link');
  });
});
