import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { getConfigDir } from '@agendex/shared';

function getPidPath(): string {
  return join(getConfigDir(), 'daemon.pid');
}

export interface DaemonPidInfo {
  pid: number;
  startedAtMs?: number;
  hostname?: string;
}

export function writePid(): void {
  const path = getPidPath();
  mkdirSync(dirname(path), { recursive: true });
  const info: DaemonPidInfo = {
    pid: process.pid,
    startedAtMs: Date.now(),
    hostname: hostname(),
  };
  writeFileSync(path, JSON.stringify(info));
}

export function readPidInfo(): DaemonPidInfo | null {
  const path = getPidPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8').trim();

  // Legacy format: bare PID number
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0 && !raw.startsWith('{')) {
    return { pid: asNumber };
  }

  // New format: JSON
  try {
    const parsed = JSON.parse(raw) as DaemonPidInfo;
    if (Number.isFinite(parsed.pid) && parsed.pid > 0) return parsed;
  } catch {}

  return null;
}

export function readPid(): number | null {
  return readPidInfo()?.pid ?? null;
}

export function removePid(): void {
  try {
    unlinkSync(getPidPath());
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
