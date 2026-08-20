import { expect, test } from 'bun:test';
import { auditWorkspaceCryptoRow } from './workspaceCryptoSeal.ts';

const envelope = {
  v: 1,
  alg: 'xchacha20poly1305',
  keyEpoch: 2,
  nonce: new Uint8Array(24).buffer,
  ciphertext: new Uint8Array(32).buffer,
};

test('rotation audit rejects old epochs and plaintext residue', () => {
  expect(
    auditWorkspaceCryptoRow(
      'tags',
      {
        keyEpoch: 2,
        stableCryptoId: 'tag-1',
        encryptedName: envelope,
        nameToken: 'opaque',
        name: '',
        nameLc: '',
      },
      2,
    ),
  ).toEqual([]);

  expect(
    auditWorkspaceCryptoRow(
      'tags',
      {
        keyEpoch: 1,
        stableCryptoId: 'tag-1',
        encryptedName: { ...envelope, keyEpoch: 1 },
        nameToken: 'opaque',
        name: 'plaintext tag',
        nameLc: 'plaintext tag',
      },
      2,
    ),
  ).toContain('old_epoch');
  expect(
    auditWorkspaceCryptoRow(
      'tags',
      {
        keyEpoch: 1,
        stableCryptoId: 'tag-1',
        encryptedName: { ...envelope, keyEpoch: 1 },
        nameToken: 'opaque',
        name: 'plaintext tag',
        nameLc: 'plaintext tag',
      },
      2,
    ),
  ).toContain('plaintext');
});
