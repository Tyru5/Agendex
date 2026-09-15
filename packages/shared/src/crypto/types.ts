export const CRYPTO_FORMAT_VERSION = 1 as const;
export const CRYPTO_ALGORITHM = 'xchacha20poly1305' as const;
export const WORKSPACE_KEY_BYTES = 32;
export const CRYPTO_NONCE_BYTES = 24;
export const CRYPTO_TAG_BYTES = 16;
export const STABLE_CRYPTO_ID_BYTES = 16;

export type WorkspaceCryptoTable =
  | 'plans'
  | 'planVersions'
  | 'planAnnotations'
  | 'comments'
  | 'commentAttachments'
  | 'planLinks'
  | 'tags'
  | 'collections'
  | 'plannotatorWritebacks'
  | 'agentAvatars'
  | 'daemonHeartbeats'
  | 'workspaceInvitations'
  | 'workspaceCryptoSettings'
  | 'workspaceKeyGrants'
  | 'memberCryptoIdentities'
  | 'exports';

export type CryptoSlot =
  | 'summary'
  | 'body'
  | 'metadata'
  | 'annotation'
  | 'comment'
  | 'attachment'
  | 'link'
  | 'name'
  | 'description'
  | 'writeback'
  | 'avatar'
  | 'hostname'
  | 'ip'
  | 'invite-secret'
  | 'owner-passphrase-wrapper'
  | 'owner-recovery-wrapper'
  | 'member-private-key'
  | 'member-recovery-private-key'
  | 'workspace-key-grant'
  | 'export';

export interface CryptoContext {
  workspaceOwnerId: string;
  table: WorkspaceCryptoTable;
  stableCryptoId: string;
  slot: CryptoSlot;
  keyEpoch: number;
}

export interface CryptoEnvelopeV1 {
  v: typeof CRYPTO_FORMAT_VERSION;
  alg: typeof CRYPTO_ALGORITHM;
  keyEpoch: number;
  nonce: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

export interface WorkspaceDerivedKeys {
  contentKey: Uint8Array;
  indexKey: Uint8Array;
  inviteKey: Uint8Array;
}

export interface ScryptKdfParamsV1 {
  v: 1;
  alg: 'scrypt';
  salt: ArrayBuffer;
  N: number;
  r: number;
  p: number;
  dkLen: 32;
  maxmem: number;
}

export interface Argon2idKdfParamsV1 {
  v: 1;
  alg: 'argon2id';
  salt: ArrayBuffer;
  memorySize: number;
  iterations: number;
  parallelism: number;
  dkLen: 32;
}

export type PassphraseKdfParamsV1 = ScryptKdfParamsV1 | Argon2idKdfParamsV1;

export interface PassphraseWrappedKeyV1 {
  v: 1;
  kdf: PassphraseKdfParamsV1;
  envelope: CryptoEnvelopeV1;
}

export interface RecoveryKitV1 {
  format: 'agendex-obfuscation-recovery';
  version: 1;
  workspaceOwnerId: string;
  keyEpoch: number;
  recoverySecret: string;
  wrappedKey: SerializedCryptoEnvelopeV1;
  checksum: string;
  warning: string;
}

export interface SerializedCryptoEnvelopeV1 {
  v: 1;
  alg: typeof CRYPTO_ALGORITHM;
  keyEpoch: number;
  nonce: string;
  ciphertext: string;
}

export type OpaqueTokenKind =
  | 'content'
  | 'local-plan'
  | 'sync-identity'
  | 'continuity'
  | 'tag-name'
  | 'collection-name'
  | 'recovery-verification';

export class CryptoFormatError extends Error {
  override name = 'CryptoFormatError';
}

export class CryptoCorruptionError extends Error {
  override name = 'CryptoCorruptionError';
}

export class CryptoKdfError extends Error {
  override name = 'CryptoKdfError';
}
