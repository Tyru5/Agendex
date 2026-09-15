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

test('macOS stores a quoted command over stdin without password prompts or secret argv', async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const run: SecretCommandRunner = async (_command, args, stdin) => {
    calls.push({ args, stdin });
    return { code: 0, stdout: '', stderr: '' };
  };
  const store = createSecretStore('darwin', run);
  await store.set('owner"\\name', 'raw-workspace-key');
  expect(calls[0]?.args).toEqual(['-i', '-q']);
  expect(calls[0]?.stdin).toBe(
    '"add-generic-password" "-a" "owner\\"\\\\name" "-s" "dev.agendex.obfuscation" "-U" "-w" "raw-workspace-key"\n',
  );
  for (const invalid of ['owner\nhelp', 'owner\rhelp', 'owner\0help']) {
    await expect(store.set(invalid, 'secret')).rejects.toThrow('Invalid macOS Keychain input');
  }
  await expect(store.set('owner', 'a'.repeat(4096))).rejects.toThrow('input is too long');
  expect(calls.length).toBe(1);
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

test('Linux availability uses a supported read-only command and checks the service', async () => {
  let serviceAvailable = true;
  const run: SecretCommandRunner = async (_command, args) => {
    // Upstream secret-tool rejects top-level --version; an empty search succeeds.
    if (args[0] !== 'search') return { code: 2, stdout: '', stderr: 'usage' };
    expect(args).toEqual([
      'search',
      'service',
      'dev.agendex.obfuscation',
      'account',
      '__availability_probe__',
    ]);
    return { code: serviceAvailable ? 0 : 1, stdout: '', stderr: '' };
  };
  const store = createSecretStore('linux', run);
  expect(await store.available()).toBe(true);
  serviceAvailable = false;
  expect(await store.available()).toBe(false);
});

test('workspace secret keys are scoped by owner and epoch', () => {
  expect(workspaceSecretKey('owner-a', 3)).toBe('workspace:owner-a:epoch:3');
});

test('locking rejects failed deletion but allows an already absent key', async () => {
  for (const platform of ['linux', 'darwin'] as const) {
    let result = { code: 1, stdout: '', stderr: 'permission denied' };
    const store = createSecretStore(platform, async () => result);
    await expect(store.delete('owner')).rejects.toThrow('could not remove the key');
    result = { code: platform === 'linux' ? 1 : 44, stdout: '', stderr: '' };
    await store.delete('owner');
  }
});
