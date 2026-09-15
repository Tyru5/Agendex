import { randomBytes } from '@noble/ciphers/utils.js';
import { argon2id, scrypt } from 'hash-wasm';
import { clearBytes, toArrayBuffer, toBytes, utf8 } from './encoding.ts';
import { openBytes, sealBytes } from './envelope.ts';
import { deriveRecoveryWrappingKey } from './keys.ts';
import {
  CryptoFormatError,
  CryptoKdfError,
  WORKSPACE_KEY_BYTES,
  type Argon2idKdfParamsV1,
  type CryptoContext,
  type CryptoEnvelopeV1,
  type PassphraseWrappedKeyV1,
  type PassphraseKdfParamsV1,
  type ScryptKdfParamsV1,
} from './types.ts';

export const DEFAULT_SCRYPT_PARAMS = Object.freeze({
  N: 2 ** 17,
  r: 8,
  p: 2,
  dkLen: 32 as const,
  maxmem: 384 * 1024 * 1024,
});

export const DEFAULT_ARGON2ID_PARAMS = Object.freeze({
  memorySize: 64 * 1024,
  iterations: 11,
  parallelism: 1,
  dkLen: 32 as const,
});

const MAX_SCRYPT_N = 2 ** 18;
const MAX_SCRYPT_R = 16;
const MAX_SCRYPT_P = 4;
const MAX_SCRYPT_MEMORY_WORK = 2 ** 21;
const MAX_SCRYPT_CPU_WORK = 2 ** 22;
const MAX_SCRYPT_MEMORY_LIMIT = 512 * 1024 * 1024;
const KDF_WARMUP_PASSWORD = 'agendex-warmup';

function wrapperContext(
  workspaceOwnerId: string,
  keyEpoch: number,
  slot: 'owner-passphrase-wrapper' | 'owner-recovery-wrapper',
): CryptoContext {
  return {
    workspaceOwnerId,
    table: 'workspaceCryptoSettings',
    stableCryptoId: workspaceOwnerId,
    slot,
    keyEpoch,
  };
}

export function createScryptParams(): ScryptKdfParamsV1 {
  return {
    v: 1,
    alg: 'scrypt',
    salt: toArrayBuffer(randomBytes(16)),
    ...DEFAULT_SCRYPT_PARAMS,
  };
}

export function createArgon2idParams(): Argon2idKdfParamsV1 {
  return {
    v: 1,
    alg: 'argon2id',
    salt: toArrayBuffer(randomBytes(16)),
    ...DEFAULT_ARGON2ID_PARAMS,
  };
}

export function createPassphraseKdfParams(): PassphraseKdfParamsV1 {
  return createArgon2idParams();
}

export function parseScryptParams(value: unknown): ScryptKdfParamsV1 {
  if (typeof value !== 'object' || value === null)
    throw new CryptoFormatError('missing KDF params');
  const params = value as Record<string, unknown>;
  const salt = toBytes(params.salt as ArrayBuffer | Uint8Array, 'KDF salt');
  if (params.v !== 1 || params.alg !== 'scrypt') throw new CryptoFormatError('unsupported KDF');
  if (salt.length !== 16) throw new CryptoFormatError('KDF salt must be 16 bytes');
  for (const field of ['N', 'r', 'p', 'dkLen', 'maxmem'] as const) {
    if (!Number.isSafeInteger(params[field]) || Number(params[field]) <= 0) {
      throw new CryptoFormatError(`invalid KDF ${field}`);
    }
  }
  const N = Number(params.N);
  if (!Number.isInteger(Math.log2(N))) throw new CryptoFormatError('KDF N must be a power of two');
  const r = Number(params.r);
  const p = Number(params.p);
  const maxmem = Number(params.maxmem);
  if (
    N > MAX_SCRYPT_N ||
    r > MAX_SCRYPT_R ||
    p > MAX_SCRYPT_P ||
    N * r > MAX_SCRYPT_MEMORY_WORK ||
    N * r * p > MAX_SCRYPT_CPU_WORK ||
    maxmem > MAX_SCRYPT_MEMORY_LIMIT
  ) {
    throw new CryptoFormatError('KDF parameters exceed this client safety limit');
  }
  const requiredMemory = 128 * N * r + 128 * r * p + 256 * r;
  if (requiredMemory > maxmem) {
    throw new CryptoFormatError('KDF memory ceiling is too low for its work factor');
  }
  if (params.dkLen !== WORKSPACE_KEY_BYTES)
    throw new CryptoFormatError('KDF key length must be 32');
  return {
    v: 1,
    alg: 'scrypt',
    salt: toArrayBuffer(salt),
    N,
    r,
    p,
    dkLen: 32,
    maxmem,
  };
}

export function parseArgon2idParams(value: unknown): Argon2idKdfParamsV1 {
  if (typeof value !== 'object' || value === null)
    throw new CryptoFormatError('missing KDF params');
  const params = value as Record<string, unknown>;
  if (params.v !== 1 || params.alg !== 'argon2id') {
    throw new CryptoFormatError('unsupported KDF');
  }
  const salt = toBytes(params.salt as ArrayBuffer | Uint8Array, 'KDF salt');
  if (salt.length !== 16) throw new CryptoFormatError('KDF salt must be 16 bytes');
  for (const field of ['memorySize', 'iterations', 'parallelism', 'dkLen'] as const) {
    if (!Number.isSafeInteger(params[field]) || Number(params[field]) <= 0) {
      throw new CryptoFormatError(`invalid KDF ${field}`);
    }
  }
  const memorySize = Number(params.memorySize);
  const iterations = Number(params.iterations);
  const parallelism = Number(params.parallelism);
  if (
    memorySize > 256 * 1024 ||
    iterations > 20 ||
    parallelism > 4 ||
    memorySize * iterations > 1024 * 1024
  ) {
    throw new CryptoFormatError('KDF parameters exceed this client safety limit');
  }
  if (params.dkLen !== WORKSPACE_KEY_BYTES) {
    throw new CryptoFormatError('KDF key length must be 32');
  }
  return {
    v: 1,
    alg: 'argon2id',
    salt: toArrayBuffer(salt),
    memorySize,
    iterations,
    parallelism,
    dkLen: 32,
  };
}

export function parsePassphraseKdfParams(value: unknown): PassphraseKdfParamsV1 {
  if (typeof value !== 'object' || value === null) {
    throw new CryptoFormatError('missing KDF params');
  }
  return (value as Record<string, unknown>).alg === 'argon2id'
    ? parseArgon2idParams(value)
    : parseScryptParams(value);
}

export async function derivePassphraseKey(
  passphrase: string,
  paramsValue: unknown,
): Promise<Uint8Array> {
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw new CryptoFormatError('passphrase must be at least 12 characters');
  }
  const params = parsePassphraseKdfParams(paramsValue);
  const passphraseBytes = utf8(passphrase);
  try {
    if (params.alg === 'argon2id') {
      return await argon2id({
        password: passphraseBytes,
        salt: toBytes(params.salt),
        memorySize: params.memorySize,
        iterations: params.iterations,
        parallelism: params.parallelism,
        hashLength: params.dkLen,
        outputType: 'binary',
      });
    }
    return await scrypt({
      password: passphraseBytes,
      salt: toBytes(params.salt),
      costFactor: params.N,
      blockSize: params.r,
      parallelism: params.p,
      hashLength: params.dkLen,
      outputType: 'binary',
    });
  } catch {
    throw new CryptoKdfError('This device could not derive the Obfuscation key');
  } finally {
    clearBytes(passphraseBytes);
  }
}

export async function prewarmPassphraseKdf(): Promise<void> {
  const password = utf8(KDF_WARMUP_PASSWORD);
  const salt = new Uint8Array(16);
  let key: Uint8Array | undefined;
  try {
    key = await argon2id({
      password,
      salt,
      memorySize: 1024,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      outputType: 'binary',
    });
  } finally {
    clearBytes(password, salt);
    if (key) clearBytes(key);
  }
}

export async function wrapWorkspaceKeyWithPassphrase(args: {
  workspaceKey: Uint8Array;
  passphrase: string;
  workspaceOwnerId: string;
  keyEpoch: number;
  kdf?: PassphraseKdfParamsV1;
}): Promise<PassphraseWrappedKeyV1> {
  if (args.workspaceKey.length !== WORKSPACE_KEY_BYTES) {
    throw new CryptoFormatError('workspace key must be 32 bytes');
  }
  const kdf = args.kdf ?? createPassphraseKdfParams();
  const wrappingKey = await derivePassphraseKey(args.passphrase, kdf);
  try {
    return {
      v: 1,
      kdf,
      envelope: sealBytes(
        wrappingKey,
        args.workspaceKey,
        wrapperContext(args.workspaceOwnerId, args.keyEpoch, 'owner-passphrase-wrapper'),
      ),
    };
  } finally {
    clearBytes(wrappingKey);
  }
}

export async function unwrapWorkspaceKeyWithPassphrase(args: {
  wrappedKey: PassphraseWrappedKeyV1;
  passphrase: string;
  workspaceOwnerId: string;
  keyEpoch: number;
}): Promise<Uint8Array> {
  if (args.wrappedKey.v !== 1) throw new CryptoFormatError('unsupported wrapped key');
  const wrappingKey = await derivePassphraseKey(args.passphrase, args.wrappedKey.kdf);
  try {
    const workspaceKey = openBytes(
      wrappingKey,
      args.wrappedKey.envelope,
      wrapperContext(args.workspaceOwnerId, args.keyEpoch, 'owner-passphrase-wrapper'),
    );
    if (workspaceKey.length !== WORKSPACE_KEY_BYTES) {
      clearBytes(workspaceKey);
      throw new CryptoFormatError('unwrapped workspace key has the wrong size');
    }
    return workspaceKey;
  } finally {
    clearBytes(wrappingKey);
  }
}

export function wrapWorkspaceKeyWithRecovery(args: {
  workspaceKey: Uint8Array;
  recoverySecret: Uint8Array;
  workspaceOwnerId: string;
  keyEpoch: number;
}): CryptoEnvelopeV1 {
  const wrappingKey = deriveRecoveryWrappingKey(args.recoverySecret);
  try {
    return sealBytes(
      wrappingKey,
      args.workspaceKey,
      wrapperContext(args.workspaceOwnerId, args.keyEpoch, 'owner-recovery-wrapper'),
    );
  } finally {
    clearBytes(wrappingKey);
  }
}

export function unwrapWorkspaceKeyWithRecovery(args: {
  wrappedKey: unknown;
  recoverySecret: Uint8Array;
  workspaceOwnerId: string;
  keyEpoch: number;
}): Uint8Array {
  const wrappingKey = deriveRecoveryWrappingKey(args.recoverySecret);
  try {
    return openBytes(
      wrappingKey,
      args.wrappedKey,
      wrapperContext(args.workspaceOwnerId, args.keyEpoch, 'owner-recovery-wrapper'),
    );
  } finally {
    clearBytes(wrappingKey);
  }
}
