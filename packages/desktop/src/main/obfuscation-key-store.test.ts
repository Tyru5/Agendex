import { expect, test } from 'bun:test';

test('desktop key custody refuses Linux plaintext fallback for writes and reads', () => {
  // Isolate Electron mocks and the simulated platform from the desktop test suite.
  const script = `
    import { mock } from 'bun:test';
    import assert from 'node:assert/strict';
    import { mkdtempSync, rmSync, existsSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const directory = mkdtempSync(join(tmpdir(), 'agendex-key-custody-'));
    let backend = 'basic_text';
    let available = true;
    let encryptions = 0;
    let decryptions = 0;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mock.module('electron', () => ({
      app: { getPath: () => directory },
      safeStorage: {
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => backend,
        encryptString: (value) => { encryptions++; return Buffer.from(value); },
        decryptString: (value) => { decryptions++; return value.toString(); },
      },
    }));
    const store = await import(${JSON.stringify(new URL('./obfuscation-key-store.ts', import.meta.url).href)});
    const key = Buffer.alloc(32, 7).toString('base64');
    try {
      assert.equal(store.storeObfuscationKey('owner', 1, key), false);
      assert.equal(encryptions, 0);
      assert.equal(existsSync(join(directory, 'obfuscation-keys')), false);
      for (const supported of ['gnome_libsecret', 'kwallet5', 'kwallet6']) {
        backend = supported;
        assert.equal(store.storeObfuscationKey('owner', 1, key), true);
        assert.equal(store.loadObfuscationKey('owner', 1), key);
      }
      const before = decryptions;
      for (const unsupported of ['basic_text', 'unknown']) {
        backend = unsupported;
        assert.equal(store.storeObfuscationKey('owner', 1, key), false);
        assert.equal(store.loadObfuscationKey('owner', 1), null);
      }
      available = false;
      backend = 'gnome_libsecret';
      assert.equal(store.storeObfuscationKey('owner', 1, key), false);
      assert.equal(store.loadObfuscationKey('owner', 1), null);
      assert.equal(decryptions, before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  `;
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
});
