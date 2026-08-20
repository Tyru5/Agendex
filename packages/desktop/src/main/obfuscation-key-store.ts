import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';

function keyPath(workspaceOwnerId: string, keyEpoch: number): string {
  const scope = createHash('sha256').update(`${workspaceOwnerId}\0${keyEpoch}`).digest('hex');
  return join(app.getPath('userData'), 'obfuscation-keys', `${scope}.json`);
}

export function storeObfuscationKey(
  workspaceOwnerId: string,
  keyEpoch: number,
  keyBase64: string,
): boolean {
  if (
    !workspaceOwnerId.trim() ||
    !Number.isSafeInteger(keyEpoch) ||
    keyEpoch < 1 ||
    !/^[A-Za-z0-9+/]{43}=$/.test(keyBase64) ||
    !safeStorage.isEncryptionAvailable()
  ) {
    return false;
  }
  const directory = join(app.getPath('userData'), 'obfuscation-keys');
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ciphertext = safeStorage.encryptString(keyBase64).toString('base64');
  writeFileSync(keyPath(workspaceOwnerId, keyEpoch), JSON.stringify({ v: 1, ciphertext }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return true;
}

export function loadObfuscationKey(workspaceOwnerId: string, keyEpoch: number): string | null {
  try {
    const path = keyPath(workspaceOwnerId, keyEpoch);
    if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null;
    const value = JSON.parse(readFileSync(path, 'utf8')) as {
      v?: number;
      ciphertext?: string;
    };
    if (value.v !== 1 || !value.ciphertext) return null;
    const plaintext = safeStorage.decryptString(Buffer.from(value.ciphertext, 'base64'));
    return /^[A-Za-z0-9+/]{43}=$/.test(plaintext) ? plaintext : null;
  } catch {
    return null;
  }
}

export function clearObfuscationKey(workspaceOwnerId: string, keyEpoch: number): void {
  rmSync(keyPath(workspaceOwnerId, keyEpoch), { force: true });
}

export function clearAllObfuscationKeys(): void {
  rmSync(join(app.getPath('userData'), 'obfuscation-keys'), { recursive: true, force: true });
}
