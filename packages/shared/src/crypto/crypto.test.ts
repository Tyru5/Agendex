import { expect, test } from 'bun:test';
import {
  CryptoCorruptionError,
  CryptoFormatError,
  base64ToBytes,
  buildAssociatedData,
  clearBytes,
  computeOpaqueToken,
  createPassphraseKdfParams,
  createRecoveryKit,
  derivePassphraseKey,
  deriveWorkspaceKeys,
  decodeUtf8,
  generateStableCryptoId,
  generateWorkspaceKey,
  openText,
  openBytes,
  parseRecoveryKit,
  recoverWorkspaceKey,
  sealText,
  serializeCryptoEnvelope,
  unwrapWorkspaceKeyWithPassphrase,
  verifyRecoveryKit,
  wrapWorkspaceKeyWithPassphrase,
  type CryptoContext,
} from './index.ts';

const context: CryptoContext = {
  workspaceOwnerId: 'owner_123',
  table: 'plans',
  stableCryptoId: 'stable_123',
  slot: 'summary',
  keyEpoch: 1,
};

test('derives distinct deterministic workspace subkeys', () => {
  const workspaceKey = new Uint8Array(32).fill(7);
  const first = deriveWorkspaceKeys(workspaceKey);
  const second = deriveWorkspaceKeys(workspaceKey);
  expect(first.contentKey).toEqual(second.contentKey);
  expect(first.indexKey).toEqual(second.indexKey);
  expect(first.inviteKey).toEqual(second.inviteKey);
  expect(first.contentKey).not.toEqual(first.indexKey);
  expect(first.indexKey).not.toEqual(first.inviteKey);
});

test('uses canonical associated data and authenticates every binding', () => {
  const key = deriveWorkspaceKeys(new Uint8Array(32).fill(9)).contentKey;
  const envelope = sealText(key, 'private plan title', context);
  expect(openText(key, envelope, context)).toBe('private plan title');
  expect(new TextDecoder().decode(buildAssociatedData(context))).toBe(
    '["agendex","v1","owner_123","plans","stable_123","summary",1]',
  );
  expect(() => openText(key, envelope, { ...context, slot: 'body' })).toThrow(
    CryptoCorruptionError,
  );
  expect(() => openText(key, envelope, { ...context, workspaceOwnerId: 'other' })).toThrow(
    CryptoCorruptionError,
  );
});

test('opens the version 1 cross-runtime known-answer vector', () => {
  const vectorContext: CryptoContext = {
    workspaceOwnerId: 'owner-vector',
    table: 'plans',
    stableCryptoId: 'plan-vector',
    slot: 'body',
    keyEpoch: 7,
  };
  const plaintext = openBytes(
    Uint8Array.from({ length: 32 }, (_, index) => index),
    {
      v: 1,
      alg: 'xchacha20poly1305',
      keyEpoch: 7,
      nonce: base64ToBytes('ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3'),
      ciphertext: base64ToBytes('XD4opR9SbKtT0D/KJmdgv04itE4MPYOPt1NhblRIk4gDDu+5'),
    },
    vectorContext,
  );
  expect(decodeUtf8(plaintext)).toBe('Agendex known answer');
});

test('rejects corrupted ciphertext instead of returning empty content', () => {
  const key = deriveWorkspaceKeys(new Uint8Array(32).fill(4)).contentKey;
  const envelope = sealText(key, 'do not erase me', context);
  const ciphertext = new Uint8Array(envelope.ciphertext.slice(0));
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
  expect(() => openText(key, { ...envelope, ciphertext: ciphertext.buffer }, context)).toThrow(
    CryptoCorruptionError,
  );
});

test('strictly parses envelope bytes and canonical base64', () => {
  const key = deriveWorkspaceKeys(new Uint8Array(32).fill(3)).contentKey;
  const serialized = serializeCryptoEnvelope(sealText(key, 'hello', context));
  expect(serialized.nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  expect(() => openText(key, { ...serialized, nonce: 'not bytes' }, context)).toThrow(
    CryptoFormatError,
  );
});

test('opaque tokens are keyed, scoped, and normalized', () => {
  const indexKey = deriveWorkspaceKeys(new Uint8Array(32).fill(2)).indexKey;
  expect(computeOpaqueToken(indexKey, 'tag-name', ['Cafe\u0301'])).toBe(
    computeOpaqueToken(indexKey, 'tag-name', ['Café']),
  );
  expect(computeOpaqueToken(indexKey, 'tag-name', ['private'])).not.toBe(
    computeOpaqueToken(indexKey, 'collection-name', ['private']),
  );
});

test('passphrase wrapper round-trips without exposing the workspace key', async () => {
  const workspaceKey = generateWorkspaceKey();
  const wrappedKey = await wrapWorkspaceKeyWithPassphrase({
    workspaceKey,
    passphrase: 'a long test passphrase',
    workspaceOwnerId: 'owner_123',
    keyEpoch: 1,
    kdf: {
      v: 1,
      alg: 'scrypt',
      salt: new Uint8Array(16).fill(8).buffer,
      N: 1024,
      r: 8,
      p: 1,
      dkLen: 32,
      maxmem: 16 * 1024 * 1024,
    },
  });
  const unwrapped = await unwrapWorkspaceKeyWithPassphrase({
    wrappedKey,
    passphrase: 'a long test passphrase',
    workspaceOwnerId: 'owner_123',
    keyEpoch: 1,
  });
  expect(unwrapped).toEqual(workspaceKey);
  let wrongPassphraseError: unknown;
  try {
    await unwrapWorkspaceKeyWithPassphrase({
      wrappedKey,
      passphrase: 'the wrong passphrase',
      workspaceOwnerId: 'owner_123',
      keyEpoch: 1,
    });
  } catch (error) {
    wrongPassphraseError = error;
  }
  expect(wrongPassphraseError instanceof CryptoCorruptionError).toBe(true);
  clearBytes(workspaceKey, unwrapped);
});

test('rejects attacker-controlled KDF parameters before expensive work begins', async () => {
  const params = {
    v: 1 as const,
    alg: 'scrypt' as const,
    salt: new Uint8Array(16).buffer,
    N: 2 ** 20,
    r: 32,
    p: 16,
    dkLen: 32 as const,
    maxmem: Number.MAX_SAFE_INTEGER,
  };
  await expect(derivePassphraseKey('a long test passphrase', params)).rejects.toThrow(
    'client safety limit',
  );
});

test('scrypt wrapper matches the version 1 cross-runtime vector', async () => {
  const key = await derivePassphraseKey('passwordpassword', {
    v: 1,
    alg: 'scrypt',
    salt: new Uint8Array(16).fill(3).buffer,
    N: 2 ** 14,
    r: 8,
    p: 2,
    dkLen: 32,
    maxmem: 64 * 1024 * 1024,
  });
  expect(Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(
    '0aa699bada244d7a6c6a0189f84c775ba111c520744066e11881047bb5201d20',
  );
  clearBytes(key);
});

test('argon2id is the default and matches the version 1 cross-runtime vector', async () => {
  expect(createPassphraseKdfParams().alg).toBe('argon2id');
  const key = await derivePassphraseKey('passwordpassword', {
    v: 1,
    alg: 'argon2id',
    salt: new Uint8Array(16).fill(3).buffer,
    memorySize: 1024,
    iterations: 2,
    parallelism: 1,
    dkLen: 32,
  });
  expect(Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(
    '6a1578d1f242f885588ca009810eff3910b2d4c9512a0b7354fbeab8c4beae69',
  );
  clearBytes(key);
});

test('recovery kit checksum and proof recover the same workspace key', () => {
  const workspaceKey = new Uint8Array(32).fill(5);
  const { kit } = createRecoveryKit({ workspaceKey, workspaceOwnerId: 'owner_123', keyEpoch: 1 });
  const serialized = JSON.stringify(kit);
  expect(parseRecoveryKit(serialized)).toEqual(kit);
  expect(recoverWorkspaceKey(serialized)).toEqual(workspaceKey);
  expect(verifyRecoveryKit(serialized, workspaceKey)).toBe(true);

  const tampered = { ...kit, workspaceOwnerId: 'other' };
  expect(() => parseRecoveryKit(tampered)).toThrow('checksum');
});

test('stable crypto IDs are random URL-safe values', () => {
  const first = generateStableCryptoId();
  const second = generateStableCryptoId();
  expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(second).not.toBe(first);
});
