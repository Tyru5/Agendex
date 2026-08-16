import { expect, test } from 'bun:test';
import {
  buildOpenLocalFileCommand,
  commandExists,
  isLocalFileOpenDisabled,
  launchOpenCommand,
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
  const windows = buildOpenLocalFileCommand('C:\\plans\\foo & bar.md', 'win32');
  expect(windows.command).toBe('powershell.exe');
  expect(windows.args).toEqual([
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Start-Process -LiteralPath $env:AGENDEX_OPEN_PATH',
  ]);
  expect(windows.args.join(' ')).not.toContain('&');
  expect(windows.options?.windowsHide).toBe(true);
  expect(windows.options?.env?.AGENDEX_OPEN_PATH).toBe('C:\\plans\\foo & bar.md');
});

test('commandExists finds binaries on PATH and rejects missing names', () => {
  expect(commandExists('definitely-not-an-agendex-opener')).toBe(false);
  expect(commandExists(process.execPath)).toBe(true);
});

test('skips launching when AGENDEX_DISABLE_BROWSER is set', async () => {
  const previous = process.env.AGENDEX_DISABLE_BROWSER;
  process.env.AGENDEX_DISABLE_BROWSER = '1';
  try {
    expect(isLocalFileOpenDisabled()).toBe(true);
    expect(await openLocalFile('/tmp/plan.md')).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.AGENDEX_DISABLE_BROWSER;
    else process.env.AGENDEX_DISABLE_BROWSER = previous;
  }
});

test('launchOpenCommand is false when the command is missing', async () => {
  expect(await launchOpenCommand('definitely-not-an-agendex-opener', [])).toBe(false);
});

test('launchOpenCommand is true once the process starts', async () => {
  expect(await launchOpenCommand(process.execPath, ['-e', 'process.exit(0)'])).toBe(true);
});

test('launchOpenCommand does not wait for a long-lived process to quit', async () => {
  const started = Date.now();
  expect(
    await launchOpenCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']),
  ).toBe(true);
  expect(Date.now() - started).toBeLessThan(1000);
});
