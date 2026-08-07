import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const scriptPath = new URL('./build-test-desktop.sh', import.meta.url);
test('desktop build commands use Bun cwd without wrapping Git Bash subshells', async () => {
  const script = await readFile(scriptPath, 'utf8');

  expect(script).toContain('bun run --cwd "$ROOT_DIR" desktop:build');
  expect(script).toContain('bun run --cwd "$DESKTOP_DIR" dist -- --mac --universal');
  expect(script).toContain('bun run --cwd "$DESKTOP_DIR" dist -- --dir --win --x64');
  expect(script).toContain(
    'run_electron_builder_with_nsis_retry --prepackaged release/win-unpacked --win nsis --x64',
  );
  expect(script).toContain(
    'run_electron_builder_with_nsis_retry --prepackaged release/win-unpacked --win portable --x64',
  );
  expect(script).not.toContain('bun run --cwd "$DESKTOP_DIR" dist -- --win --x64');
  expect(script).not.toMatch(/\(cd "\$(?:ROOT_DIR|DESKTOP_DIR)" && bun run/);
});

test('desktop packaging retries only the transient makensis loader failure', async () => {
  const script = await readFile(scriptPath, 'utf8');

  expect(script).toContain('local max_attempts=3');
  expect(script).toContain("grep -q '3221225794'");
  expect(script).toContain('return "$status"');
});
