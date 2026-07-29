import { execFileSync } from 'node:child_process';
import { writeSync } from 'node:fs';

let windowsUtf8ConsoleReady = false;

export type WindowsUtf8ConsoleRunner = () => void;

const defaultWindowsUtf8ConsoleRunner: WindowsUtf8ConsoleRunner = () => {
  execFileSync('chcp.com', ['65001'], {
    stdio: 'ignore',
    windowsHide: true,
  });
};

/**
 * On Windows consoles, writing UTF-8 bytes to the raw stdout/stderr fd goes
 * through WriteFile and is decoded with the active OEM/ANSI code page. That
 * turns glyphs like ✓ / • / × into mojibake (e.g. Γ£ô). Prefer stream writes
 * so Node can use WriteConsoleW, and switch the console to UTF-8 so any
 * remaining byte-oriented writes (and Bun's stdout path) stay intact.
 */
export function shouldUseUnicodeConsoleWrite(
  stream: Pick<NodeJS.WriteStream, 'isTTY'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && Boolean(stream.isTTY);
}

export function ensureWindowsUtf8Console(options?: {
  platform?: NodeJS.Platform;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  run?: WindowsUtf8ConsoleRunner;
}): void {
  if (windowsUtf8ConsoleReady) return;

  const platform = options?.platform ?? process.platform;
  const stdoutIsTTY = options?.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  const stderrIsTTY = options?.stderrIsTTY ?? Boolean(process.stderr.isTTY);
  if (platform !== 'win32') return;
  if (!stdoutIsTTY && !stderrIsTTY) return;

  windowsUtf8ConsoleReady = true;
  const run = options?.run ?? defaultWindowsUtf8ConsoleRunner;
  try {
    run();
  } catch {
    // Best-effort: WriteConsoleW stream writes still work without this.
  }
}

/** Test helper — resets the one-shot UTF-8 console guard. */
export function resetWindowsUtf8ConsoleForTests(): void {
  windowsUtf8ConsoleReady = false;
}

export function writeStdout(message: string): void {
  writeLine(process.stdout, message);
}

export function writeStderr(message: string): void {
  writeLine(process.stderr, message);
}

export function writeLine(stream: NodeJS.WriteStream, message: string): void {
  ensureWindowsUtf8Console();
  const data = `${message}\n`;
  if (shouldUseUnicodeConsoleWrite(stream)) {
    stream.write(data);
    return;
  }
  writeSync(stream.fd, data);
}
