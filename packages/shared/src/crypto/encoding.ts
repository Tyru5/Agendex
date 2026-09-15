import { sha256 } from '@noble/hashes/sha2.js';
import { CryptoFormatError } from './types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(value: string): Uint8Array {
  return encoder.encode(value.normalize('NFC'));
}

export function decodeUtf8(value: Uint8Array): string {
  try {
    return decoder.decode(value);
  } catch {
    throw new CryptoFormatError('Encrypted content is not valid UTF-8');
  }
}

export function toBytes(value: ArrayBuffer | Uint8Array, label = 'bytes'): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new CryptoFormatError(`${label} must be bytes`);
}

export function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer;
}

export function bytesToBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = toBytes(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string, label = 'base64'): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    throw new CryptoFormatError(`${label} is not canonical base64`);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CryptoFormatError(`${label} is not canonical base64`);
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytesToBase64(bytes) !== value) throw new Error('non-canonical');
    return bytes;
  } catch {
    throw new CryptoFormatError(`${label} is not canonical base64`);
  }
}

export function bytesToBase64Url(value: ArrayBuffer | Uint8Array): string {
  return bytesToBase64(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string, label = 'base64url'): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new CryptoFormatError(`${label} is not canonical base64url`);
  }
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const bytes = base64ToBytes(
    `${value.replaceAll('-', '+').replaceAll('_', '/')}${padding}`,
    label,
  );
  if (bytesToBase64Url(bytes) !== value) {
    clearBytes(bytes);
    throw new CryptoFormatError(`${label} is not canonical base64url`);
  }
  return bytes;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function checksumBase64(value: string): string {
  return bytesToBase64(sha256(utf8(value)));
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function clearBytes(...values: Uint8Array[]): void {
  for (const value of values) value.fill(0);
}
