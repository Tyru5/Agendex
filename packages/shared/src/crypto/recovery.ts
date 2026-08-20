import {
  base64ToBytes,
  bytesToBase64,
  canonicalJson,
  clearBytes,
  checksumBase64,
  equalBytes,
} from './encoding.ts';
import { deserializeCryptoEnvelope, serializeCryptoEnvelope } from './envelope.ts';
import { generateRecoverySecret } from './keys.ts';
import {
  CryptoFormatError,
  type CryptoEnvelopeV1,
  type RecoveryKitV1,
  type SerializedCryptoEnvelopeV1,
} from './types.ts';
import { unwrapWorkspaceKeyWithRecovery, wrapWorkspaceKeyWithRecovery } from './wrapping.ts';

export const RECOVERY_WARNING =
  'Keep this file private. Anyone with it can decrypt this workspace. Agendex cannot replace it.';

function checksumPayload(kit: Omit<RecoveryKitV1, 'checksum'>): string {
  return canonicalJson([
    kit.format,
    kit.version,
    kit.workspaceOwnerId,
    kit.keyEpoch,
    kit.recoverySecret,
    kit.wrappedKey.v,
    kit.wrappedKey.alg,
    kit.wrappedKey.keyEpoch,
    kit.wrappedKey.nonce,
    kit.wrappedKey.ciphertext,
    kit.warning,
  ]);
}

export function createRecoveryKit(args: {
  workspaceKey: Uint8Array;
  workspaceOwnerId: string;
  keyEpoch: number;
  recoverySecret?: Uint8Array;
}): { kit: RecoveryKitV1; recoveryEnvelope: CryptoEnvelopeV1 } {
  const generatedSecret = args.recoverySecret === undefined;
  const recoverySecret = args.recoverySecret ?? generateRecoverySecret();
  try {
    const recoveryEnvelope = wrapWorkspaceKeyWithRecovery({ ...args, recoverySecret });
    const unsigned: Omit<RecoveryKitV1, 'checksum'> = {
      format: 'agendex-obfuscation-recovery',
      version: 1,
      workspaceOwnerId: args.workspaceOwnerId,
      keyEpoch: args.keyEpoch,
      recoverySecret: bytesToBase64(recoverySecret),
      wrappedKey: serializeCryptoEnvelope(recoveryEnvelope),
      warning: RECOVERY_WARNING,
    };
    return {
      kit: { ...unsigned, checksum: checksumBase64(checksumPayload(unsigned)) },
      recoveryEnvelope,
    };
  } finally {
    if (generatedSecret) clearBytes(recoverySecret);
  }
}

function parseSerializedEnvelope(value: unknown): SerializedCryptoEnvelopeV1 {
  if (typeof value !== 'object' || value === null)
    throw new CryptoFormatError('missing recovery key');
  const record = value as Record<string, unknown>;
  return {
    v: record.v as 1,
    alg: record.alg as 'xchacha20poly1305',
    keyEpoch: Number(record.keyEpoch),
    nonce: String(record.nonce ?? ''),
    ciphertext: String(record.ciphertext ?? ''),
  };
}

export function parseRecoveryKit(value: string | unknown): RecoveryKitV1 {
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      throw new CryptoFormatError('recovery kit is not valid JSON');
    }
  }
  if (typeof decoded !== 'object' || decoded === null)
    throw new CryptoFormatError('invalid recovery kit');
  const record = decoded as Record<string, unknown>;
  const kit: RecoveryKitV1 = {
    format: record.format as RecoveryKitV1['format'],
    version: record.version as 1,
    workspaceOwnerId: String(record.workspaceOwnerId ?? ''),
    keyEpoch: Number(record.keyEpoch),
    recoverySecret: String(record.recoverySecret ?? ''),
    wrappedKey: parseSerializedEnvelope(record.wrappedKey),
    checksum: String(record.checksum ?? ''),
    warning: String(record.warning ?? ''),
  };
  if (kit.format !== 'agendex-obfuscation-recovery' || kit.version !== 1) {
    throw new CryptoFormatError('unsupported recovery kit');
  }
  if (!kit.workspaceOwnerId || !Number.isSafeInteger(kit.keyEpoch) || kit.keyEpoch < 1) {
    throw new CryptoFormatError('invalid recovery kit identity');
  }
  const secret = base64ToBytes(kit.recoverySecret, 'recovery secret');
  try {
    if (secret.length !== 32) throw new CryptoFormatError('recovery secret must be 32 bytes');
  } finally {
    clearBytes(secret);
  }
  deserializeCryptoEnvelope(kit.wrappedKey);
  const { checksum: _checksum, ...unsigned } = kit;
  const expected = checksumBase64(checksumPayload(unsigned));
  if (!equalBytes(base64ToBytes(kit.checksum, 'recovery checksum'), base64ToBytes(expected))) {
    throw new CryptoFormatError('recovery kit checksum does not match');
  }
  return kit;
}

export function recoverWorkspaceKey(kitValue: string | unknown): Uint8Array {
  const kit = parseRecoveryKit(kitValue);
  const recoverySecret = base64ToBytes(kit.recoverySecret, 'recovery secret');
  try {
    return unwrapWorkspaceKeyWithRecovery({
      wrappedKey: deserializeCryptoEnvelope(kit.wrappedKey),
      recoverySecret,
      workspaceOwnerId: kit.workspaceOwnerId,
      keyEpoch: kit.keyEpoch,
    });
  } finally {
    clearBytes(recoverySecret);
  }
}

export function verifyRecoveryKit(kitValue: string | unknown, expectedKey: Uint8Array): boolean {
  const recovered = recoverWorkspaceKey(kitValue);
  try {
    return equalBytes(recovered, expectedKey);
  } finally {
    clearBytes(recovered);
  }
}
