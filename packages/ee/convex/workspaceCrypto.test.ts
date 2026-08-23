import { expect, test } from 'bun:test';
import {
  assertNoPlaintext,
  assertCompleteRotationGrantSet,
  assertKdfParams,
  assertWorkspaceCryptoTransition,
  canReadLegacyDuringSeal,
  validateEncryptedWrite,
  validateEnvelopeStructure,
  workspaceCryptoRolloutAllows,
  workspaceCryptoTeamRolloutAllows,
  type WorkspaceCryptoPolicy,
} from './workspaceCrypto.ts';

const envelope = {
  v: 1,
  alg: 'xchacha20poly1305',
  keyEpoch: 2,
  nonce: new Uint8Array(24).buffer,
  ciphertext: new Uint8Array(32).buffer,
};

const policy: WorkspaceCryptoPolicy = {
  ownerId: 'owner',
  state: 'sealed',
  requiresEncryption: true,
  activeKeyEpoch: 2,
  minimumClientProtocol: 1,
};

test('validates envelope structure and current epoch', () => {
  expect(() => validateEnvelopeStructure(envelope, { expectedEpoch: 2 })).not.toThrow();
  expect(() =>
    validateEnvelopeStructure({ ...envelope, nonce: new Uint8Array(12).buffer }),
  ).toThrow('nonce');
  expect(() =>
    validateEnvelopeStructure({ ...envelope, keyEpoch: 1 }, { expectedEpoch: 2 }),
  ).toThrow('stale');
});

test('encrypted workspaces reject plaintext and obsolete clients', () => {
  expect(() =>
    validateEncryptedWrite({
      policy,
      clientProtocol: 1,
      envelopes: [envelope],
      plaintext: { title: '', content: '' },
    }),
  ).not.toThrow();
  expect(() =>
    validateEncryptedWrite({
      policy,
      clientProtocol: 0,
      envelopes: [envelope],
      plaintext: { title: '', content: '' },
    }),
  ).toThrow('upgraded');
  expect(() => assertNoPlaintext({ title: 'leak' })).toThrow('Plaintext title');
});

test('state transitions are irreversible and legacy reads end after sealing', () => {
  expect(() => assertWorkspaceCryptoTransition('disabled', 'preparing')).not.toThrow();
  expect(() => assertWorkspaceCryptoTransition('sealed', 'disabled')).toThrow('Invalid');
  expect(canReadLegacyDuringSeal({ ...policy, state: 'sealing' })).toBe(true);
  expect(canReadLegacyDuringSeal(policy)).toBe(false);
});

test('rollout flag supports an explicit allowlist or all workspaces', () => {
  expect(workspaceCryptoRolloutAllows('owner-a', 'owner-a, owner-b')).toBe(true);
  expect(workspaceCryptoRolloutAllows('owner-c', 'owner-a, owner-b')).toBe(false);
  expect(workspaceCryptoRolloutAllows('owner-c', 'all')).toBe(true);
  expect(workspaceCryptoRolloutAllows('owner-c', '')).toBe(false);
});

test('team rollout is independently default-off and allowlisted', () => {
  expect(workspaceCryptoTeamRolloutAllows('owner-a', '')).toBe(false);
  expect(workspaceCryptoTeamRolloutAllows('owner-a', 'owner-a, owner-b')).toBe(true);
  expect(workspaceCryptoTeamRolloutAllows('owner-c', 'owner-a, owner-b')).toBe(false);
  expect(workspaceCryptoTeamRolloutAllows('owner-c', 'all')).toBe(true);
});

test('rotation requires exactly one grant for every remaining member', () => {
  expect(() =>
    assertCompleteRotationGrantSet(['member-a', 'member-b'], ['member-a', 'member-b']),
  ).not.toThrow();
  expect(() =>
    assertCompleteRotationGrantSet(['member-a', 'member-b'], ['member-a', 'member-a']),
  ).toThrow('Every remaining member');
  expect(() => assertCompleteRotationGrantSet(['member-a'], ['member-c'])).toThrow(
    'Every remaining member',
  );
});

test('server rejects abusive KDF resource parameters', () => {
  const supported = {
    alg: 'scrypt' as const,
    salt: new Uint8Array(16).buffer,
    N: 2 ** 17,
    r: 8,
    p: 2,
    dkLen: 32 as const,
    maxmem: 384 * 1024 * 1024,
  };
  expect(() => assertKdfParams(supported)).not.toThrow();
  expect(() =>
    assertKdfParams({ ...supported, N: 2 ** 20, p: 16, maxmem: Number.MAX_SAFE_INTEGER }),
  ).toThrow('resource cost');
  expect(() =>
    assertKdfParams({
      alg: 'argon2id',
      salt: new Uint8Array(16).buffer,
      memorySize: 64 * 1024,
      iterations: 11,
      parallelism: 1,
      dkLen: 32,
    }),
  ).not.toThrow();
});
