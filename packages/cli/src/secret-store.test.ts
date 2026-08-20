import { expect, test } from 'bun:test';
import { createSecretStore, workspaceSecretKey, type SecretCommandRunner } from './secret-store.ts';

test('Linux Secret Service backend passes secrets only through stdin', async () => {
  const calls: Array<{ command: string; args: string[]; stdin?: string }> = [];
  const run: SecretCommandRunner = async (command, args, stdin) => {
    calls.push({ command, args, stdin });
    if (args[0] === 'lookup') return { code: 0, stdout: 'stored-secret\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const store = createSecretStore('linux', run);
  await store.set('owner', 'raw-workspace-key');
  expect(await store.get('owner')).toBe('stored-secret');
  expect(calls.some((call) => call.args.includes('raw-workspace-key'))).toBe(false);
  expect(calls.find((call) => call.args[0] === 'store')?.stdin).toBe('raw-workspace-key');
});

test('unsupported systems never fall back to a plaintext file', async () => {
  const store = createSecretStore('freebsd');
  expect(await store.available()).toBe(false);
  let error: unknown;
  try {
    await store.set('owner', 'secret');
  } catch (caught) {
    error = caught;
  }
  expect(error instanceof Error).toBe(true);
});

test('missing platform secret-store commands report unavailable', async () => {
  const run: SecretCommandRunner = async () => {
    throw new Error('spawn secret-tool ENOENT');
  };

  const store = createSecretStore('linux', run);
  expect(await store.available()).toBe(false);
});

test('workspace secret keys are scoped by owner and epoch', () => {
  expect(workspaceSecretKey('owner-a', 3)).toBe('workspace:owner-a:epoch:3');
});
