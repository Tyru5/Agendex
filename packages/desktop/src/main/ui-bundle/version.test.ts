import { expect, test } from 'bun:test';
import { compareVersions, satisfiesMinShellVersion } from './version.ts';

test('orders versions by numeric segment', () => {
  expect(compareVersions('1.4.15', '1.4.15')).toBe(0);
  expect(compareVersions('1.4.16', '1.4.15')).toBe(1);
  expect(compareVersions('1.4.9', '1.4.10')).toBe(-1);
  expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
});

test('treats missing segments as zero', () => {
  expect(compareVersions('1.4', '1.4.0')).toBe(0);
  expect(compareVersions('1.4.1', '1.4')).toBe(1);
});

test('ignores prerelease and build suffixes', () => {
  // A prerelease of 1.4.16 still has 1.4.16's IPC surface, which is what the
  // gate is actually asking about.
  expect(compareVersions('1.4.16-beta.2', '1.4.16')).toBe(0);
  expect(compareVersions('1.4.16+ui.3', '1.4.16')).toBe(0);
  expect(satisfiesMinShellVersion('1.4.16-rc.1', '1.4.16')).toBe(true);
});

test('gates bundles that need a newer shell', () => {
  expect(satisfiesMinShellVersion('1.4.15', '1.4.15')).toBe(true);
  expect(satisfiesMinShellVersion('1.5.0', '1.4.15')).toBe(true);
  expect(satisfiesMinShellVersion('1.4.14', '1.4.15')).toBe(false);
});

test('does not throw on malformed input', () => {
  expect(compareVersions('', '1.0.0')).toBe(-1);
  expect(compareVersions('not-a-version', '0.0.0')).toBe(0);
});
