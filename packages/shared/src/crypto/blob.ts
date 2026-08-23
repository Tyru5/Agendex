import { toArrayBuffer, toBytes } from './encoding.ts';
import { parseCryptoEnvelope } from './envelope.ts';
import {
  CRYPTO_ALGORITHM,
  CRYPTO_FORMAT_VERSION,
  CryptoFormatError,
  type CryptoEnvelopeV1,
} from './types.ts';

const MAGIC = new Uint8Array([0x41, 0x47, 0x58, 0x31]); // AGX1
const HEADER_BYTES = MAGIC.length + 4 + 24;

export function packEncryptedBlob(envelopeValue: unknown): Uint8Array {
  const envelope = parseCryptoEnvelope(envelopeValue);
  const nonce = toBytes(envelope.nonce);
  const ciphertext = toBytes(envelope.ciphertext);
  const output = new Uint8Array(HEADER_BYTES + ciphertext.length);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(MAGIC.length, envelope.keyEpoch, false);
  output.set(nonce, MAGIC.length + 4);
  output.set(ciphertext, HEADER_BYTES);
  return output;
}

export function unpackEncryptedBlob(value: ArrayBuffer | Uint8Array): CryptoEnvelopeV1 {
  const bytes = toBytes(value, 'encrypted blob');
  if (bytes.length < HEADER_BYTES + 16) throw new CryptoFormatError('encrypted blob is truncated');
  for (let index = 0; index < MAGIC.length; index++) {
    if (bytes[index] !== MAGIC[index])
      throw new CryptoFormatError('encrypted blob has invalid magic');
  }
  const keyEpoch = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    MAGIC.length,
    false,
  );
  return parseCryptoEnvelope({
    v: CRYPTO_FORMAT_VERSION,
    alg: CRYPTO_ALGORITHM,
    keyEpoch,
    nonce: toArrayBuffer(bytes.slice(MAGIC.length + 4, HEADER_BYTES)),
    ciphertext: toArrayBuffer(bytes.slice(HEADER_BYTES)),
  });
}
