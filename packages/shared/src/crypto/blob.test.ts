import { expect, test } from 'bun:test';
import { openBytes, packEncryptedBlob, sealBytes, unpackEncryptedBlob } from './index.ts';

test('packs a versioned encrypted storage object without losing authentication data', () => {
  const key = new Uint8Array(32).fill(12);
  const context = {
    workspaceOwnerId: 'owner',
    table: 'commentAttachments' as const,
    stableCryptoId: 'attachment',
    slot: 'attachment' as const,
    keyEpoch: 4,
  };
  const envelope = sealBytes(key, new Uint8Array([1, 2, 3, 4]), context);
  const packed = packEncryptedBlob(envelope);
  expect(new TextDecoder().decode(packed.slice(0, 4))).toBe('AGX1');
  expect(openBytes(key, unpackEncryptedBlob(packed), context)).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );
});
