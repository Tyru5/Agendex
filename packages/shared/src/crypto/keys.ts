import { randomBytes } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToBase64Url, canonicalJson, utf8 } from './encoding.ts';
import {
  CryptoFormatError,
  STABLE_CRYPTO_ID_BYTES,
  WORKSPACE_KEY_BYTES,
  type OpaqueTokenKind,
  type WorkspaceDerivedKeys,
} from './types.ts';

const HKDF_SALT = utf8('agendex:workspace-key-schedule:v1');

function assertKey(key: Uint8Array, label: string): void {
  if (!(key instanceof Uint8Array) || key.length !== WORKSPACE_KEY_BYTES) {
    throw new CryptoFormatError(`${label} must be ${WORKSPACE_KEY_BYTES} bytes`);
  }
}

export function generateWorkspaceKey(): Uint8Array {
  return randomBytes(WORKSPACE_KEY_BYTES);
}

export function generateRecoverySecret(): Uint8Array {
  return randomBytes(WORKSPACE_KEY_BYTES);
}

export function generateStableCryptoId(): string {
  return bytesToBase64Url(randomBytes(STABLE_CRYPTO_ID_BYTES));
}

export function deriveWorkspaceKeys(workspaceKey: Uint8Array): WorkspaceDerivedKeys {
  assertKey(workspaceKey, 'workspace key');
  return {
    contentKey: hkdf(sha256, workspaceKey, HKDF_SALT, utf8('agendex:data:v1'), 32),
    indexKey: hkdf(sha256, workspaceKey, HKDF_SALT, utf8('agendex:index:v1'), 32),
    inviteKey: hkdf(sha256, workspaceKey, HKDF_SALT, utf8('agendex:invite:v1'), 32),
  };
}

export function deriveRecoveryWrappingKey(recoverySecret: Uint8Array): Uint8Array {
  assertKey(recoverySecret, 'recovery secret');
  return hkdf(
    sha256,
    recoverySecret,
    utf8('agendex:recovery-wrap:salt:v1'),
    utf8('agendex:recovery-wrap:v1'),
    32,
  );
}

export function computeOpaqueToken(
  indexKey: Uint8Array,
  kind: OpaqueTokenKind,
  values: readonly string[],
): string {
  assertKey(indexKey, 'index key');
  if (values.length === 0) throw new CryptoFormatError('opaque token requires input');
  const canonicalValues = values.map((value) => value.normalize('NFC'));
  return bytesToBase64Url(
    hmac(sha256, indexKey, utf8(canonicalJson(['agendex-token-v1', kind, canonicalValues]))),
  );
}

export function computeRecoveryVerificationProof(
  indexKey: Uint8Array,
  workspaceOwnerId: string,
  keyEpoch: number,
): string {
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) {
    throw new CryptoFormatError('key epoch must be a positive integer');
  }
  return computeOpaqueToken(indexKey, 'recovery-verification', [
    workspaceOwnerId,
    String(keyEpoch),
  ]);
}
