import { expect, test } from 'bun:test';
import { detectPackageManager, isLikelyGlobalInstall } from './upgrade.ts';

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
