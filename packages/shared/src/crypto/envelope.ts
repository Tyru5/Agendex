import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import {
  base64ToBytes,
  bytesToBase64,
  canonicalJson,
  decodeUtf8,
  toArrayBuffer,
  toBytes,
  utf8,
} from './encoding.ts';
import {
  CRYPTO_ALGORITHM,
  CRYPTO_FORMAT_VERSION,
  CRYPTO_NONCE_BYTES,
  CRYPTO_TAG_BYTES,
  CryptoCorruptionError,
  CryptoFormatError,
  WORKSPACE_KEY_BYTES,
  type CryptoContext,
  type CryptoEnvelopeV1,
  type SerializedCryptoEnvelopeV1,
} from './types.ts';

function assertContext(context: CryptoContext): void {
  const strings = [context.workspaceOwnerId, context.table, context.stableCryptoId, context.slot];
  if (
    strings.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 256)
  ) {
    throw new CryptoFormatError('invalid encryption context');
  }
  if (!Number.isSafeInteger(context.keyEpoch) || context.keyEpoch < 1) {
    throw new CryptoFormatError('key epoch must be a positive integer');
  }
}

export function buildAssociatedData(context: CryptoContext): Uint8Array {
  assertContext(context);
  return utf8(
    canonicalJson([
      'agendex',
      'v1',
      context.workspaceOwnerId,
      context.table,
      context.stableCryptoId,
      context.slot,
      context.keyEpoch,
    ]),
  );
}

export function parseCryptoEnvelope(value: unknown): CryptoEnvelopeV1 {
  if (typeof value !== 'object' || value === null) throw new CryptoFormatError('missing envelope');
  const record = value as Record<string, unknown>;
  if (record.v !== CRYPTO_FORMAT_VERSION)
    throw new CryptoFormatError('unsupported envelope version');
  if (record.alg !== CRYPTO_ALGORITHM)
    throw new CryptoFormatError('unsupported envelope algorithm');
  if (!Number.isSafeInteger(record.keyEpoch) || Number(record.keyEpoch) < 1) {
    throw new CryptoFormatError('invalid envelope key epoch');
  }
  const nonce = toBytes(record.nonce as ArrayBuffer | Uint8Array, 'envelope nonce');
  const ciphertext = toBytes(record.ciphertext as ArrayBuffer | Uint8Array, 'envelope ciphertext');
  if (nonce.length !== CRYPTO_NONCE_BYTES) throw new CryptoFormatError('invalid envelope nonce');
  if (ciphertext.length < CRYPTO_TAG_BYTES)
    throw new CryptoFormatError('invalid envelope ciphertext');
  return {
    v: CRYPTO_FORMAT_VERSION,
    alg: CRYPTO_ALGORITHM,
    keyEpoch: Number(record.keyEpoch),
    nonce: toArrayBuffer(nonce),
    ciphertext: toArrayBuffer(ciphertext),
  };
}

export function sealBytes(
  key: Uint8Array,
  plaintext: Uint8Array,
  context: CryptoContext,
): CryptoEnvelopeV1 {
  if (key.length !== WORKSPACE_KEY_BYTES)
    throw new CryptoFormatError('content key must be 32 bytes');
  if (!(plaintext instanceof Uint8Array)) throw new CryptoFormatError('plaintext must be bytes');
  assertContext(context);
  const nonce = randomBytes(CRYPTO_NONCE_BYTES);
  const ciphertext = xchacha20poly1305(key, nonce, buildAssociatedData(context)).encrypt(plaintext);
  return {
    v: CRYPTO_FORMAT_VERSION,
    alg: CRYPTO_ALGORITHM,
    keyEpoch: context.keyEpoch,
    nonce: toArrayBuffer(nonce),
    ciphertext: toArrayBuffer(ciphertext),
  };
}

export function openBytes(
  key: Uint8Array,
  envelopeValue: unknown,
  context: CryptoContext,
): Uint8Array {
  if (key.length !== WORKSPACE_KEY_BYTES)
    throw new CryptoFormatError('content key must be 32 bytes');
  const envelope = parseCryptoEnvelope(envelopeValue);
  if (envelope.keyEpoch !== context.keyEpoch)
    throw new CryptoFormatError('envelope epoch mismatch');
  try {
    return xchacha20poly1305(key, toBytes(envelope.nonce), buildAssociatedData(context)).decrypt(
      toBytes(envelope.ciphertext),
    );
  } catch {
    throw new CryptoCorruptionError('Encrypted content failed authentication');
  }
}

export function sealText(
  key: Uint8Array,
  plaintext: string,
  context: CryptoContext,
): CryptoEnvelopeV1 {
  return sealBytes(key, utf8(plaintext), context);
}

export function openText(key: Uint8Array, envelope: unknown, context: CryptoContext): string {
  return decodeUtf8(openBytes(key, envelope, context));
}

export function serializeCryptoEnvelope(envelopeValue: unknown): SerializedCryptoEnvelopeV1 {
  const envelope = parseCryptoEnvelope(envelopeValue);
  return {
    v: 1,
    alg: CRYPTO_ALGORITHM,
    keyEpoch: envelope.keyEpoch,
    nonce: bytesToBase64(envelope.nonce),
    ciphertext: bytesToBase64(envelope.ciphertext),
  };
}

export function deserializeCryptoEnvelope(value: unknown): CryptoEnvelopeV1 {
  if (typeof value !== 'object' || value === null) throw new CryptoFormatError('missing envelope');
  const record = value as Record<string, unknown>;
  return parseCryptoEnvelope({
    v: record.v,
    alg: record.alg,
    keyEpoch: record.keyEpoch,
    nonce: base64ToBytes(String(record.nonce ?? ''), 'envelope nonce'),
    ciphertext: base64ToBytes(String(record.ciphertext ?? ''), 'envelope ciphertext'),
  });
}
