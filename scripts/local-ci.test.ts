import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const scriptPath = new URL('./local-ci.sh', import.meta.url);

test('local act uses the cached digest-pinned runner image when available', async () => {
  const script = await readFile(scriptPath, 'utf8');

  expect(script).toContain("ACT_RUNNER_IMAGE='node:22-bookworm@sha256:");
  expect(script).toContain('docker image inspect "$ACT_RUNNER_IMAGE"');
  expect(script).toContain('docker pull "$ACT_RUNNER_IMAGE"');
  expect(script).toContain('--pull=false');
});
