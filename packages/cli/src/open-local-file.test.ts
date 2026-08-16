import { expect, test } from 'bun:test';
import {
  buildOpenLocalFileCommand,
  commandExists,
  isLocalFileOpenDisabled,
  openLocalFile,
} from './open-local-file.ts';

test('builds platform-specific open commands', () => {
  expect(buildOpenLocalFileCommand('/tmp/plan.md', 'darwin')).toEqual({
    command: 'open',
    args: ['/tmp/plan.md'],
  });
  expect(buildOpenLocalFileCommand('/tmp/plan.md', 'linux')).toEqual({
    command: 'xdg-open',
    args: ['/tmp/plan.md'],
  });
  expect(buildOpenLocalFileCommand('C:\\plans\\plan.md', 'win32')).toEqual({
    command: 'cmd',
    args: ['/c', 'start', '', 'C:\\plans\\plan.md'],
    options: { windowsHide: true },
  });
});

test('commandExists finds binaries on PATH and rejects missing names', () => {
  expect(commandExists('definitely-not-an-agendex-opener')).toBe(false);
  expect(commandExists(process.execPath)).toBe(true);
});

test('skips launching when AGENDEX_DISABLE_BROWSER is set', () => {
  const previous = process.env.AGENDEX_DISABLE_BROWSER;
  process.env.AGENDEX_DISABLE_BROWSER = '1';
  try {
    expect(isLocalFileOpenDisabled()).toBe(true);
    expect(openLocalFile('/tmp/plan.md')).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.AGENDEX_DISABLE_BROWSER;
    else process.env.AGENDEX_DISABLE_BROWSER = previous;
  }
});
