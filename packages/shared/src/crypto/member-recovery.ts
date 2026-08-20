import {
  base64ToBytes,
  bytesToBase64,
  canonicalJson,
  checksumBase64,
  equalBytes,
  clearBytes,
} from './encoding.ts';
import { deserializeCryptoEnvelope, serializeCryptoEnvelope } from './envelope.ts';
import { unwrapMemberPrivateKeyWithRecovery } from './member.ts';
import { CryptoFormatError, type CryptoEnvelopeV1 } from './types.ts';

export interface MemberRecoveryKitV1 {
  format: 'agendex-member-obfuscation-recovery';
  version: 1;
  userId: string;
  keyVersion: number;
  recoverySecret: string;
  recoveryWrappedPrivateKey: ReturnType<typeof serializeCryptoEnvelope>;
  warning: string;
  checksum: string;
}

export const MEMBER_RECOVERY_WARNING =
  'Keep this file private. Anyone with it and a workspace grant can decrypt that workspace. Agendex cannot replace it.';

function checksumPayload(kit: Omit<MemberRecoveryKitV1, 'checksum'>): string {
  return canonicalJson([
    kit.format,
    kit.version,
    kit.userId,
    kit.keyVersion,
    kit.recoverySecret,
    kit.recoveryWrappedPrivateKey.v,
    kit.recoveryWrappedPrivateKey.alg,
    kit.recoveryWrappedPrivateKey.keyEpoch,
    kit.recoveryWrappedPrivateKey.nonce,
    kit.recoveryWrappedPrivateKey.ciphertext,
    kit.warning,
  ]);
}

export function createMemberRecoveryKit(args: {
  userId: string;
  keyVersion: number;
  recoverySecret: Uint8Array;
  recoveryWrappedPrivateKey: CryptoEnvelopeV1;
}): MemberRecoveryKitV1 {
  const unsigned: Omit<MemberRecoveryKitV1, 'checksum'> = {
    format: 'agendex-member-obfuscation-recovery',
    version: 1,
    userId: args.userId,
    keyVersion: args.keyVersion,
    recoverySecret: bytesToBase64(args.recoverySecret),
    recoveryWrappedPrivateKey: serializeCryptoEnvelope(args.recoveryWrappedPrivateKey),
    warning: MEMBER_RECOVERY_WARNING,
  };
  return { ...unsigned, checksum: checksumBase64(checksumPayload(unsigned)) };
}

export function parseMemberRecoveryKit(value: string | unknown): MemberRecoveryKitV1 {
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      throw new CryptoFormatError('member recovery kit is not valid JSON');
    }
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new CryptoFormatError('invalid member recovery kit');
  }
  const record = decoded as Record<string, unknown>;
  const envelopeRecord = record.recoveryWrappedPrivateKey;
  if (
    typeof envelopeRecord !== 'object' ||
    envelopeRecord === null ||
    Array.isArray(envelopeRecord)
  ) {
    throw new CryptoFormatError('member recovery kit is missing its wrapped key');
  }
  const envelope = envelopeRecord as Record<string, unknown>;
  const kit: MemberRecoveryKitV1 = {
    format: record.format as MemberRecoveryKitV1['format'],
    version: record.version as 1,
    userId: String(record.userId ?? ''),
    keyVersion: Number(record.keyVersion),
    recoverySecret: String(record.recoverySecret ?? ''),
    recoveryWrappedPrivateKey: {
      v: envelope.v as 1,
      alg: envelope.alg as 'xchacha20poly1305',
      keyEpoch: Number(envelope.keyEpoch),
      nonce: String(envelope.nonce ?? ''),
      ciphertext: String(envelope.ciphertext ?? ''),
    },
    warning: String(record.warning ?? ''),
    checksum: String(record.checksum ?? ''),
  };
  if (kit.format !== 'agendex-member-obfuscation-recovery' || kit.version !== 1) {
    throw new CryptoFormatError('unsupported member recovery kit');
  }
  if (!kit.userId || !Number.isSafeInteger(kit.keyVersion) || kit.keyVersion < 1) {
    throw new CryptoFormatError('invalid member recovery identity');
  }
  const recoverySecret = base64ToBytes(kit.recoverySecret, 'member recovery secret');
  try {
    if (recoverySecret.length !== 32) {
      throw new CryptoFormatError('member recovery secret must be 32 bytes');
    }
  } finally {
    clearBytes(recoverySecret);
  }
  deserializeCryptoEnvelope(kit.recoveryWrappedPrivateKey);
  const { checksum: _checksum, ...unsigned } = kit;
  const expected = checksumBase64(checksumPayload(unsigned));
  if (
    !equalBytes(base64ToBytes(kit.checksum, 'member recovery checksum'), base64ToBytes(expected))
  ) {
    throw new CryptoFormatError('member recovery kit checksum does not match');
  }
  return kit;
}

export function recoverMemberPrivateKey(
  value: string | unknown,
  expected?: { userId: string; keyVersion: number },
): Uint8Array {
  const kit = parseMemberRecoveryKit(value);
  if (expected && (kit.userId !== expected.userId || kit.keyVersion !== expected.keyVersion)) {
    throw new CryptoFormatError('member recovery kit belongs to a different identity');
  }
  const recoverySecret = base64ToBytes(kit.recoverySecret, 'member recovery secret');
  try {
    return unwrapMemberPrivateKeyWithRecovery({
      recoveryWrappedPrivateKey: deserializeCryptoEnvelope(kit.recoveryWrappedPrivateKey),
      recoverySecret,
      userId: kit.userId,
      keyVersion: kit.keyVersion,
    });
  } finally {
    clearBytes(recoverySecret);
  }
}
