import { expect, test } from 'bun:test';
import {
  createWorkspaceSetupMaterial,
  getWorkspaceKeyringSnapshot,
  lockAllWorkspaceKeys,
  lockWorkspaceKey,
  restoreWorkspaceKeyFromDesktop,
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
  expect(withWorkspaceKey('owner-a', (key) => key[0], 2)).toBe(7);
  expect(() => withWorkspaceKey('owner-a', () => true, 3)).toThrow('locked');
  expect(() => withWorkspaceKey('owner-b', () => true)).toThrow('locked');

  lockWorkspaceKey('owner-a');
  expect(getWorkspaceKeyringSnapshot('owner-a').status).toBe('locked');
  expect(() => withWorkspaceKey('owner-a', () => true)).toThrow('locked');
  expect(notifications).toBe(2);
  unsubscribe();
});

for (const lockAll of [false, true]) {
  test(`an in-flight device restore cannot undo ${lockAll ? 'logout' : 'an explicit lock'}`, async () => {
    lockAllWorkspaceKeys();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    let complete!: (value: string) => void;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        agendexDesktop: {
          isDesktop: true,
          loadObfuscationKey: () =>
            new Promise<string>((resolve) => {
              complete = resolve;
            }),
        },
      },
    });
    try {
      const restored = restoreWorkspaceKeyFromDesktop('restore-owner', 1);
      if (lockAll) lockAllWorkspaceKeys();
      else lockWorkspaceKey('restore-owner');
      complete(Buffer.from(new Uint8Array(32).fill(9)).toString('base64'));
      expect(await restored).toBe(false);
      expect(getWorkspaceKeyringSnapshot('restore-owner').status).toBe('locked');
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
}

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
