import { writeSync } from 'node:fs';

/**
 * On Windows consoles, writing UTF-8 bytes to the raw stdout/stderr fd goes
 * through WriteFile and is decoded with the active OEM/ANSI code page. That
 * turns glyphs like ✓ / • / × into mojibake (e.g. Γ£ô). Prefer stream writes
 * so Node/Bun can use WriteConsoleW, which is Unicode and does not depend on
 * (or mutate) the shared console code page.
 */
export function shouldUseUnicodeConsoleWrite(
  stream: Pick<NodeJS.WriteStream, 'isTTY'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && Boolean(stream.isTTY);
}

export function writeStdout(message: string): void {
  writeLine(process.stdout, message);
}

export function writeStderr(message: string): void {
  writeLine(process.stderr, message);
}

export function writeLine(stream: NodeJS.WriteStream, message: string): void {
  const data = `${message}\n`;
  if (shouldUseUnicodeConsoleWrite(stream)) {
    stream.write(data);
    return;
  }
  writeSync(stream.fd, data);
}
