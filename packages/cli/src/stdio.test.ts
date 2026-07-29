import { afterEach, expect, test } from 'bun:test';
import {
  applyWindowsUtf8ConsoleCodePage,
  ensureWindowsUtf8Console,
  parseActiveCodePage,
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

test('parses active code page from chcp output', () => {
  expect(parseActiveCodePage('Active code page: 437')).toBe('437');
  expect(parseActiveCodePage('Active code page: 65001\r\n')).toBe('65001');
  expect(parseActiveCodePage('no code page here')).toBeNull();
});

test('restores previous Windows console code page on process exit', () => {
  const sets: string[] = [];
  let exitListener: (() => void) | undefined;

  applyWindowsUtf8ConsoleCodePage({
    readActive: () => '437',
    set: (codePage) => {
      sets.push(codePage);
    },
    onExit: (listener) => {
      exitListener = listener;
    },
  });

  expect(sets).toEqual(['65001']);
  expect(exitListener).toBeDefined();

  exitListener?.();
  expect(sets).toEqual(['65001', '437']);
});

test('skips restore when console was already UTF-8', () => {
  const sets: string[] = [];
  let exitRegistered = false;

  applyWindowsUtf8ConsoleCodePage({
    readActive: () => '65001',
    set: (codePage) => {
      sets.push(codePage);
    },
    onExit: () => {
      exitRegistered = true;
    },
  });

  expect(sets).toEqual(['65001']);
  expect(exitRegistered).toBe(false);
});
