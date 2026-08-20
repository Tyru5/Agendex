import { describe, expect, test } from 'bun:test';
import { generateMemberIdentityKeyPair } from './hpke.ts';
import { wrapMemberPrivateKey } from './member.ts';
import {
  createMemberRecoveryKit,
  parseMemberRecoveryKit,
  recoverMemberPrivateKey,
} from './member-recovery.ts';

describe('member recovery kit', () => {
  test('recovers a member private key and rejects tampering or another identity', async () => {
    const identity = await generateMemberIdentityKeyPair();
    const wrapped = await wrapMemberPrivateKey({
      privateKey: identity.privateKey,
      passphrase: 'a long unique passphrase',
      userId: 'member-1',
      keyVersion: 1,
    });
    const kit = createMemberRecoveryKit({
      userId: 'member-1',
      keyVersion: 1,
      recoverySecret: wrapped.recoverySecret,
      recoveryWrappedPrivateKey: wrapped.recoveryWrappedPrivateKey,
    });

    expect(recoverMemberPrivateKey(kit, { userId: 'member-1', keyVersion: 1 })).toEqual(
      identity.privateKey,
    );
    expect(() => recoverMemberPrivateKey(kit, { userId: 'member-2', keyVersion: 1 })).toThrow();
    expect(() => parseMemberRecoveryKit({ ...kit, userId: 'member-2' })).toThrow();
  });
});
