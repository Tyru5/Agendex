import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  expect(windows.command).toBe('powershell');
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

test('commandExists on win32 does not append PATHEXT to an already-suffixed name', () => {
  const dir = join(tmpdir(), `agendex-pathext-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tool.exe'), '');
  const prevPath = process.env.PATH;
  const prevPathExt = process.env.PATHEXT;
  process.env.PATH = dir;
  process.env.PATHEXT = '.EXE;.CMD';
  try {
    expect(commandExists('tool.exe', 'win32')).toBe(true);
    expect(commandExists('tool', 'win32')).toBe(true);
    expect(commandExists('missing.exe', 'win32')).toBe(false);
  } finally {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = prevPathExt;
    rmSync(dir, { recursive: true, force: true });
  }
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
