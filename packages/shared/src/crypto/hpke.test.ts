import { describe, expect, test } from 'bun:test';
import {
  CryptoCorruptionError,
  generateMemberIdentityKeyPair,
  openWorkspaceKeyGrant,
  sealWorkspaceKeyGrant,
} from './index.ts';

describe('RFC 9180 workspace key grants', () => {
  test('round-trips a workspace key and binds owner, member, and epoch', async () => {
    const identity = await generateMemberIdentityKeyPair();
    const workspaceKey = new Uint8Array(32).fill(9);
    const grant = await sealWorkspaceKeyGrant({
      workspaceKey,
      recipientPublicKey: identity.publicKey,
      workspaceOwnerId: 'owner-a',
      memberId: 'member-a',
      keyEpoch: 4,
    });
    expect(
      await openWorkspaceKeyGrant({
        grant,
        recipientPrivateKey: identity.privateKey,
        workspaceOwnerId: 'owner-a',
        memberId: 'member-a',
        keyEpoch: 4,
      }),
    ).toEqual(workspaceKey);
    await expect(
      openWorkspaceKeyGrant({
        grant,
        recipientPrivateKey: identity.privateKey,
        workspaceOwnerId: 'owner-a',
        memberId: 'member-b',
        keyEpoch: 4,
      }),
    ).rejects.toBeInstanceOf(CryptoCorruptionError);
  });

  test('rejects public-key substitution and ciphertext tampering', async () => {
    const recipient = await generateMemberIdentityKeyPair();
    const attacker = await generateMemberIdentityKeyPair();
    const grant = await sealWorkspaceKeyGrant({
      workspaceKey: new Uint8Array(32).fill(3),
      recipientPublicKey: recipient.publicKey,
      workspaceOwnerId: 'owner-a',
      memberId: 'member-a',
      keyEpoch: 1,
    });
    await expect(
      openWorkspaceKeyGrant({
        grant,
        recipientPrivateKey: attacker.privateKey,
        workspaceOwnerId: 'owner-a',
        memberId: 'member-a',
        keyEpoch: 1,
      }),
    ).rejects.toBeInstanceOf(CryptoCorruptionError);
    grant.ciphertext[0] ^= 1;
    await expect(
      openWorkspaceKeyGrant({
        grant,
        recipientPrivateKey: recipient.privateKey,
        workspaceOwnerId: 'owner-a',
        memberId: 'member-a',
        keyEpoch: 1,
      }),
    ).rejects.toBeInstanceOf(CryptoCorruptionError);
  });
});
