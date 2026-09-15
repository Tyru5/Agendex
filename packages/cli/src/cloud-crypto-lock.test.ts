import { expect, test } from 'bun:test';

test('lock refuses to claim success when cloud state or persisted key removal is unavailable', () => {
  const script = `
    import { mock } from 'bun:test';
    import assert from 'node:assert/strict';
    let status = null;
    let available = false;
    let deleteFails = false;
    let deletions = 0;
    mock.module(${JSON.stringify(new URL('./api.ts', import.meta.url).pathname)}, () => ({
      fetchWorkspaceCryptoStatus: async () => status,
    }));
    mock.module(${JSON.stringify(new URL('./secret-store.ts', import.meta.url).pathname)}, () => ({
      workspaceSecretKey: (owner, epoch) => owner + ':' + epoch,
      createSecretStore: () => ({
        backend: 'linux-secret-service',
        available: async () => available,
        delete: async () => {
          if (deleteFails) throw new Error('deletion denied');
          deletions++;
        },
      }),
    }));
    const crypto = await import(${JSON.stringify(new URL('./cloud-crypto.ts', import.meta.url).href)});
    await assert.rejects(crypto.runLockCommand(), /stored keys were not removed/);
    status = { enabled: true, workspaceOwnerId: 'owner', activeKeyEpoch: 1 };
    crypto.setInjectedWorkspaceKey('owner', 1, Buffer.alloc(32, 7).toString('base64'));
    await assert.rejects(crypto.runLockCommand(), /persisted Obfuscation keys could not be removed/);
    assert.equal(crypto.getInjectedWorkspaceKey('owner', 1), null);
    available = true;
    deleteFails = true;
    await assert.rejects(crypto.runLockCommand(), /deletion denied/);
    deleteFails = false;
    assert.equal(await crypto.runLockCommand(), 0);
    assert.equal(deletions, 1);
  `;
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
});
