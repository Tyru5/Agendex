import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from '@agendex/shared';

export interface SecretStore {
  readonly backend: 'macos-keychain' | 'windows-dpapi' | 'linux-secret-service' | 'unavailable';
  available(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, secret: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type SecretCommandResult = { code: number; stdout: string; stderr: string };
export type SecretCommandRunner = (
  command: string,
  args: string[],
  stdin?: string,
) => Promise<SecretCommandResult>;

export class SecretStoreUnavailableError extends Error {
  override name = 'SecretStoreUnavailableError';
}

const SERVICE = 'dev.agendex.obfuscation';

export const runSecretCommand: SecretCommandRunner = (command, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin);
  });

function macosSecretStore(run: SecretCommandRunner): SecretStore {
  return {
    backend: 'macos-keychain',
    available: async () => (await run('security', ['help'])).code === 0,
    get: async (key) => {
      const result = await run('security', [
        'find-generic-password',
        '-a',
        key,
        '-s',
        SERVICE,
        '-w',
      ]);
      return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
    },
    set: async (key, secret) => {
      const result = await run(
        'security',
        ['add-generic-password', '-a', key, '-s', SERVICE, '-U', '-w'],
        secret,
      );
      if (result.code !== 0)
        throw new SecretStoreUnavailableError('macOS Keychain rejected the key');
    },
    delete: async (key) => {
      await run('security', ['delete-generic-password', '-a', key, '-s', SERVICE]);
    },
  };
}

function linuxSecretStore(run: SecretCommandRunner): SecretStore {
  return {
    backend: 'linux-secret-service',
    available: async () => (await run('secret-tool', ['--version'])).code === 0,
    get: async (key) => {
      const result = await run('secret-tool', ['lookup', 'service', SERVICE, 'account', key]);
      return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
    },
    set: async (key, secret) => {
      const result = await run(
        'secret-tool',
        ['store', '--label=Agendex Obfuscation', 'service', SERVICE, 'account', key],
        secret,
      );
      if (result.code !== 0) {
        throw new SecretStoreUnavailableError('Secret Service rejected the key');
      }
    },
    delete: async (key) => {
      await run('secret-tool', ['clear', 'service', SERVICE, 'account', key]);
    },
  };
}

const PROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security;',
  '$value=[Console]::In.ReadToEnd();',
  '$bytes=[Text.Encoding]::UTF8.GetBytes($value);',
  '$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);',
  '[Convert]::ToBase64String($protected)',
].join(' ');

const UNPROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security;',
  '$value=[Console]::In.ReadToEnd();',
  '$bytes=[Convert]::FromBase64String($value);',
  '$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);',
  '[Text.Encoding]::UTF8.GetString($plain)',
].join(' ');

function windowsSecretPath(key: string): string {
  const name = createHash('sha256').update(key).digest('hex');
  return join(getConfigDir(), 'secrets', `obfuscation-${name}.dpapi`);
}

function windowsSecretStore(run: SecretCommandRunner): SecretStore {
  const command = 'powershell.exe';
  return {
    backend: 'windows-dpapi',
    available: async () =>
      (
        await run(command, [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$PSVersionTable.PSVersion.ToString()',
        ])
      ).code === 0,
    get: async (key) => {
      let protectedValue: string;
      try {
        protectedValue = await readFile(windowsSecretPath(key), 'utf8');
      } catch {
        return null;
      }
      const result = await run(
        command,
        ['-NoProfile', '-NonInteractive', '-Command', UNPROTECT_SCRIPT],
        protectedValue,
      );
      return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
    },
    set: async (key, secret) => {
      const result = await run(
        command,
        ['-NoProfile', '-NonInteractive', '-Command', PROTECT_SCRIPT],
        secret,
      );
      if (result.code !== 0)
        throw new SecretStoreUnavailableError('Windows DPAPI rejected the key');
      const path = windowsSecretPath(key);
      await mkdir(join(getConfigDir(), 'secrets'), { recursive: true, mode: 0o700 });
      await writeFile(path, result.stdout.trim(), { encoding: 'utf8', mode: 0o600 });
    },
    delete: async (key) => {
      await rm(windowsSecretPath(key), { force: true });
    },
  };
}

const unavailableStore: SecretStore = {
  backend: 'unavailable',
  available: async () => false,
  get: async () => null,
  set: async () => {
    throw new SecretStoreUnavailableError(
      'No supported operating-system secret store is available',
    );
  },
  delete: async () => {},
};

export function createSecretStore(
  platform: NodeJS.Platform = process.platform,
  run: SecretCommandRunner = runSecretCommand,
): SecretStore {
  if (platform === 'darwin') return macosSecretStore(run);
  if (platform === 'win32') return windowsSecretStore(run);
  if (platform === 'linux') return linuxSecretStore(run);
  return unavailableStore;
}

export function workspaceSecretKey(workspaceOwnerId: string, keyEpoch: number): string {
  return `workspace:${workspaceOwnerId}:epoch:${keyEpoch}`;
}
