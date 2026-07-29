import { expect, test } from 'bun:test';
import { shouldUseUnicodeConsoleWrite } from './stdio.ts';

test('uses Unicode console writes only for Windows TTYs', () => {
  expect(shouldUseUnicodeConsoleWrite({ isTTY: true }, 'win32')).toBe(true);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: false }, 'win32')).toBe(false);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: true }, 'linux')).toBe(false);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: true }, 'darwin')).toBe(false);
  expect(shouldUseUnicodeConsoleWrite({ isTTY: false }, 'linux')).toBe(false);
});
