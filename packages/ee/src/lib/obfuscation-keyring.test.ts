import { expect, test } from 'bun:test';
import {
  createWorkspaceSetupMaterial,
  getWorkspaceKeyringSnapshot,
  lockAllWorkspaceKeys,
  lockWorkspaceKey,
  subscribeWorkspaceKeyring,
  unlockWorkspaceKey,
  withWorkspaceKey,
} from './obfuscation-keyring.ts';

test('keyring unlocks, notifies, scopes keys, and locks explicitly', () => {
  lockAllWorkspaceKeys();
  let notifications = 0;
  const unsubscribe = subscribeWorkspaceKeyring(() => notifications++);
  const input = new Uint8Array(32).fill(7);
  unlockWorkspaceKey('owner-a', 2, input);
  input.fill(0);

  expect(getWorkspaceKeyringSnapshot('owner-a')).toEqual({
    status: 'unlocked',
    workspaceOwnerId: 'owner-a',
    keyEpoch: 2,
  });
  expect(withWorkspaceKey('owner-a', (key) => key[0])).toBe(7);
  expect(() => withWorkspaceKey('owner-b', () => true)).toThrow('locked');

  lockWorkspaceKey('owner-a');
  expect(getWorkspaceKeyringSnapshot('owner-a').status).toBe('locked');
  expect(() => withWorkspaceKey('owner-a', () => true)).toThrow('locked');
  expect(notifications).toBe(2);
  unsubscribe();
});

test('setup cancellation fails before running the KDF', async () => {
  const abortController = new AbortController();
  abortController.abort();
  await expect(
    createWorkspaceSetupMaterial({
      passphrase: 'a sufficiently long passphrase',
      workspaceOwnerId: 'owner-a',
      keyEpoch: 1,
      signal: abortController.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
