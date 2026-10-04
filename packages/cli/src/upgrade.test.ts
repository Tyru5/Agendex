import { expect, test } from 'bun:test';
import {
  buildGlobalInstallCommand,
  detectPackageManager,
  isLikelyGlobalInstall,
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

test('upgrades Deno installs from JSR, pinned when the latest version is known', () => {
  expect(buildGlobalInstallCommand('deno', '5.10.2')).toEqual({
    supported: true,
    command: {
      bin: 'deno',
      args: ['install', '-g', '-A', '-f', '-n', 'agendex', 'jsr:@agendex/cli@5.10.2'],
      display: 'deno install -g -A -f -n agendex jsr:@agendex/cli@5.10.2',
    },
  });
  const unpinned = buildGlobalInstallCommand('deno');
  expect(unpinned.supported && unpinned.command.args.at(-1)).toBe('jsr:@agendex/cli');
});
