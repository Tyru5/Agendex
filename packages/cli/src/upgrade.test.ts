import { expect, test } from 'bun:test';
import {
  buildGlobalInstallCommand,
  detectPackageManager,
  isLikelyGlobalInstall,
  pickJsrInstallVersion,
  resolveSpawnCommand,
} from './upgrade.ts';

test('recognizes existing global package layouts', () => {
  const cases: Array<[string, ReturnType<typeof detectPackageManager>]> = [
    ['/usr/local/lib/node_modules/agendex-cli', 'npm'],
    ['/Users/test/.bun/install/global/node_modules/agendex-cli', 'bun'],
    ['/Users/test/.local/share/pnpm/global/5/node_modules/agendex-cli', 'pnpm'],
    ['/Users/test/.config/yarn/global/node_modules/agendex-cli', 'yarn'],
  ];

  for (const [packageRoot, packageManager] of cases) {
    expect(isLikelyGlobalInstall(packageRoot, [])).toBe(true);
    expect(detectPackageManager(packageRoot, [])).toBe(packageManager);
  }
});

test('recognizes Bun global commands installed from a local file dependency', () => {
  expect(
    isLikelyGlobalInstall('/Users/test/project/Agendex/packages/cli/.release', [
      '/Users/test/.bun/bin/agendex',
    ]),
  ).toBe(true);
  expect(
    detectPackageManager('/Users/test/project/Agendex/packages/cli/.release', [
      '/Users/test/.bun/bin/agendex',
    ]),
  ).toBe('bun');
});

test('still rejects directly invoked local checkout builds', () => {
  expect(
    isLikelyGlobalInstall('/Users/test/project/Agendex/packages/cli/.release', [
      '/Users/test/project/Agendex/packages/cli/.release/dist/cli.js',
    ]),
  ).toBe(false);
});

test('recognizes Deno installs from the JSR package', () => {
  const globals = globalThis as { Deno?: unknown };
  globals.Deno = {};
  try {
    for (const packageRoot of [
      '/home/test/.cache/deno/npm/registry.npmjs.org/agendex-cli/5.10.1',
      'C:\\Users\\test\\AppData\\Local\\deno\\npm\\registry.npmjs.org\\agendex-cli\\5.10.1',
    ]) {
      expect(isLikelyGlobalInstall(packageRoot, [])).toBe(true);
      expect(detectPackageManager(packageRoot, [])).toBe('deno');
    }
  } finally {
    delete globals.Deno;
  }
});

test('upgrades Deno installs from JSR, pinned to JSR latest when known', () => {
  expect(buildGlobalInstallCommand('deno', '5.10.2')).toEqual({
    supported: true,
    command: {
      bin: 'deno',
      args: ['install', '-g', '-A', '-f', '-n', 'agendex', 'jsr:@agendex/cli@5.10.2'],
      display: 'deno install -g -A -f -n agendex jsr:@agendex/cli@5.10.2',
    },
  });
  const unpinned = buildGlobalInstallCommand('deno');
  expect(unpinned.supported && unpinned.command.display).toBe(
    'deno install -g -A -f --reload=jsr:@agendex/cli -n agendex jsr:@agendex/cli',
  );
});

test("picks the newest JSR version Deno's 24h minimum dependency age allows", () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const meta = {
    latest: '5.10.3',
    versions: {
      '5.10.0': { createdAt: '2026-10-01T00:00:00Z' },
      '5.10.1': { createdAt: '2026-10-02T00:00:00Z' },
      '5.10.2': { createdAt: '2026-10-03T00:00:00Z', yanked: true },
      '5.10.3': { createdAt: '2026-10-05T06:00:00Z' },
    },
  };
  expect(pickJsrInstallVersion(meta, '5.10.0', { now })).toBe('5.10.1');
  expect(pickJsrInstallVersion(meta, '5.10.1', { now })).toBeUndefined();
  expect(pickJsrInstallVersion(meta, '5.10.1', { now, includeCurrent: true })).toBe('5.10.1');
  expect(pickJsrInstallVersion(meta, '5.10.1', { now: Date.parse('2026-10-06T07:00:00Z') })).toBe(
    '5.10.3',
  );
});

test('pins npm/pnpm/bun installs to the target version, falling back to latest', () => {
  const npm = buildGlobalInstallCommand('npm', '5.11.0');
  expect(npm.supported && npm.command.args).toEqual(['install', '-g', 'agendex-cli@5.11.0']);
  const pnpm = buildGlobalInstallCommand('pnpm', '5.11.0-beta.1');
  expect(pnpm.supported && pnpm.command.display).toBe('pnpm add -g agendex-cli@5.11.0-beta.1');
  const bun = buildGlobalInstallCommand('bun');
  expect(bun.supported && bun.command.display).toBe('bun add -g agendex-cli@latest');
  const unsafe = buildGlobalInstallCommand('npm', '5.11.0 & calc');
  expect(unsafe.supported && unsafe.command.args).toEqual(['install', '-g', 'agendex-cli@latest']);
});

test('spawns Windows package-manager .cmd shims through the shell', () => {
  expect(resolveSpawnCommand('npm', 'win32')).toEqual({ command: 'npm.cmd', shell: true });
  expect(resolveSpawnCommand('pnpm', 'win32')).toEqual({ command: 'pnpm.cmd', shell: true });
  expect(resolveSpawnCommand('yarn', 'win32')).toEqual({ command: 'yarn.cmd', shell: true });
  expect(resolveSpawnCommand('bun', 'win32')).toEqual({ command: 'bun', shell: false });
  expect(resolveSpawnCommand('deno', 'win32')).toEqual({ command: 'deno', shell: false });
  expect(resolveSpawnCommand('npm', 'linux')).toEqual({ command: 'npm', shell: false });
  expect(resolveSpawnCommand('npm', 'darwin')).toEqual({ command: 'npm', shell: false });
});
