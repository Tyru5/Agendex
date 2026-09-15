import { clearBytes } from './encoding.ts';
import { openBytes, sealBytes } from './envelope.ts';
import { deriveRecoveryWrappingKey, generateRecoverySecret } from './keys.ts';
import { createPassphraseKdfParams, derivePassphraseKey } from './wrapping.ts';
import {
  CryptoFormatError,
  type CryptoEnvelopeV1,
  type CryptoSlot,
  type PassphraseKdfParamsV1,
} from './types.ts';

function memberContext(userId: string, keyVersion: number, slot: CryptoSlot) {
  return {
    workspaceOwnerId: userId,
    table: 'memberCryptoIdentities' as const,
    stableCryptoId: userId,
    slot,
    keyEpoch: keyVersion,
  };
}

export async function wrapMemberPrivateKey(args: {
  privateKey: Uint8Array;
  passphrase: string;
  userId: string;
  keyVersion: number;
  recoverySecret?: Uint8Array;
}): Promise<{
  kdf: PassphraseKdfParamsV1;
  encryptedPrivateKey: CryptoEnvelopeV1;
  recoveryWrappedPrivateKey: CryptoEnvelopeV1;
  recoverySecret: Uint8Array;
}> {
  if (args.privateKey.length !== 32)
    throw new CryptoFormatError('member private key must be 32 bytes');
  const kdf = createPassphraseKdfParams();
  const passphraseKey = await derivePassphraseKey(args.passphrase, kdf);
  const recoverySecret = args.recoverySecret?.slice() ?? generateRecoverySecret();
  const recoveryKey = deriveRecoveryWrappingKey(recoverySecret);
  try {
    return {
      kdf,
      encryptedPrivateKey: sealBytes(
        passphraseKey,
        args.privateKey,
        memberContext(args.userId, args.keyVersion, 'member-private-key'),
      ),
      recoveryWrappedPrivateKey: sealBytes(
        recoveryKey,
        args.privateKey,
        memberContext(args.userId, args.keyVersion, 'member-recovery-private-key'),
      ),
      recoverySecret,
    };
  } finally {
    clearBytes(passphraseKey, recoveryKey);
  }
}

export async function unwrapMemberPrivateKeyWithPassphrase(args: {
  encryptedPrivateKey: unknown;
  kdf: PassphraseKdfParamsV1;
  passphrase: string;
  userId: string;
  keyVersion: number;
}): Promise<Uint8Array> {
  const passphraseKey = await derivePassphraseKey(args.passphrase, args.kdf);
  try {
    return openBytes(
      passphraseKey,
      args.encryptedPrivateKey,
      memberContext(args.userId, args.keyVersion, 'member-private-key'),
    );
  } finally {
    clearBytes(passphraseKey);
  }
}

export function unwrapMemberPrivateKeyWithRecovery(args: {
  recoveryWrappedPrivateKey: unknown;
  recoverySecret: Uint8Array;
  userId: string;
  keyVersion: number;
}): Uint8Array {
  const recoveryKey = deriveRecoveryWrappingKey(args.recoverySecret);
  try {
    return openBytes(
      recoveryKey,
      args.recoveryWrappedPrivateKey,
      memberContext(args.userId, args.keyVersion, 'member-recovery-private-key'),
    );
  } finally {
    clearBytes(recoveryKey);
  }
}
