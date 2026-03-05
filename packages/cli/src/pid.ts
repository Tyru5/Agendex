import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const pidPath = join(homedir(), '.agendex', 'daemon.pid');

export function writePid(): void {
  writeFileSync(pidPath, String(process.pid));
}

export function readPid(): number | null {
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, 'utf-8').trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function removePid(): void {
  try {
    unlinkSync(pidPath);
  } catch {}
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
