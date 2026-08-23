import { describe, expect, test } from 'bun:test';
import { CryptoCorruptionError, decryptWorkspaceValue, encryptWorkspaceValue } from './index.ts';

describe('workspace values', () => {
  test('round-trips structured data and binds it to its record and slot', () => {
    const workspaceKey = new Uint8Array(32).fill(7);
    const encrypted = encryptWorkspaceValue({
      workspaceKey,
      workspaceOwnerId: 'owner-1',
      keyEpoch: 2,
      table: 'comments',
      slot: 'comment',
      value: { body: 'private', authorName: 'Ada' },
    });

    expect(
      decryptWorkspaceValue({
        workspaceKey,
        workspaceOwnerId: 'owner-1',
        keyEpoch: 2,
        table: 'comments',
        slot: 'comment',
        stableCryptoId: encrypted.stableCryptoId,
        envelope: encrypted.envelope,
      }),
    ).toEqual({ body: 'private', authorName: 'Ada' });

    expect(() =>
      decryptWorkspaceValue({
        workspaceKey,
        workspaceOwnerId: 'owner-1',
        keyEpoch: 2,
        table: 'comments',
        slot: 'attachment',
        stableCryptoId: encrypted.stableCryptoId,
        envelope: encrypted.envelope,
      }),
    ).toThrow(CryptoCorruptionError);
  });
});
