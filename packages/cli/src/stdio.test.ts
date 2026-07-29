import { afterEach, expect, test } from 'bun:test';
import {
  ensureWindowsUtf8Console,
  resetWindowsUtf8ConsoleForTests,
  shouldUseUnicodeConsoleWrite,
} from './stdio.ts';

afterEach(() => {
  resetWindowsUtf8ConsoleForTests();
});

test('uses Unicode console writes only for Windows TTYs', () => {
  expect(shouldUseUnicodeConsoleWrite({ isTTY: true }, 'win32')).toBe(true);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: false }, 'win32')).toBe(false);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: true }, 'linux')).toBe(false);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: true }, 'darwin')).toBe(false);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: false }, 'linux')).toBe(false);
});

test('enables UTF-8 console code page once on Windows TTYs', () => {
  let calls = 0;
  const run = () => {
    calls += 1;
  };

  ensureWindowsUtf8Console({
    platform: 'linux',
    stdoutIsTTY: true,
    stderrIsTTY: true,
    run,
  });
  ensureWindowsUtf8Console({
    platform: 'win32',
    stdoutIsTTY: false,
    stderrIsTTY: false,
    run,
  });
  expect(calls).toBe(0);

  ensureWindowsUtf8Console({
    platform: 'win32',
    stdoutIsTTY: true,
    stderrIsTTY: false,
    run,
  });
  ensureWindowsUtf8Console({
    platform: 'win32',
    stdoutIsTTY: true,
    stderrIsTTY: true,
    run,
  });
  expect(calls).toBe(1);
});

test('swallows UTF-8 console setup failures', () => {
  expect(() =>
    ensureWindowsUtf8Console({
      platform: 'win32',
      stdoutIsTTY: true,
      run: () => {
        throw new Error('chcp unavailable');
      },
    }),
  ).not.toThrow();
});
