import { execFileSync } from 'node:child_process';
import { writeSync } from 'node:fs';

let windowsUtf8ConsoleReady = false;
let previousWindowsCodePage: string | null = null;
let windowsCodePageRestoreRegistered = false;

export type WindowsUtf8ConsoleRunner = () => void;

export type WindowsUtf8CodePageCommands = {
  readActive: () => string | null;
  set: (codePage: string) => void;
  onExit: (listener: () => void) => void;
};

/** Parse `chcp.com` stdout for the active code page number. */
export function parseActiveCodePage(output: string): string | null {
  const match = /:\s*(\d+)\s*$/m.exec(output.trim()) ?? /\b(\d{2,5})\b/.exec(output);
  return match?.[1] ?? null;
}

function readActiveCodePage(): string | null {
  const output = execFileSync('chcp.com', [], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return parseActiveCodePage(output);
}

function setConsoleCodePage(codePage: string): void {
  execFileSync('chcp.com', [codePage], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

/**
 * Switch the Windows console to UTF-8 for this process, restoring the prior
 * code page when the process exits so the parent shell is left unchanged.
 */
export function applyWindowsUtf8ConsoleCodePage(
  commands?: Partial<WindowsUtf8CodePageCommands>,
): void {
  const readActive = commands?.readActive ?? readActiveCodePage;
  const set = commands?.set ?? setConsoleCodePage;
  const onExit =
    commands?.onExit ??
    ((listener: () => void) => {
      process.on('exit', listener);
    });

  const previous = readActive();
  set('65001');
  if (previous == null || previous === '65001') return;

  previousWindowsCodePage = previous;
  if (!windowsCodePageRestoreRegistered) {
    windowsCodePageRestoreRegistered = true;
    const codePageToRestore = previous;
    onExit(() => {
      try {
        set(codePageToRestore);
      } catch {
        // Best-effort: leaving UTF-8 is preferable to crashing on exit.
      }
      if (previousWindowsCodePage === codePageToRestore) {
        previousWindowsCodePage = null;
      }
    });
  }
}

const defaultWindowsUtf8ConsoleRunner: WindowsUtf8ConsoleRunner = () => {
  applyWindowsUtf8ConsoleCodePage();
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
  previousWindowsCodePage = null;
  windowsCodePageRestoreRegistered = false;
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
