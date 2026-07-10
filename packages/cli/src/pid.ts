import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { getConfigDir } from '@agendex/shared';

export interface DaemonPathOptions {
  configDir?: string;
}

function resolveConfigDir(options: DaemonPathOptions): string {
  return options.configDir ?? getConfigDir();
}

function getPidPath(options: DaemonPathOptions): string {
  return join(resolveConfigDir(options), 'daemon.pid');
}

function getStartLockPath(options: DaemonPathOptions): string {
  return join(resolveConfigDir(options), 'daemon.start.lock');
}

export interface DaemonPidInfo {
  pid: number;
  startedAtMs?: number;
  hostname?: string;
  launcher?: 'cli' | 'desktop';
  parentPid?: number;
}

export function writePid(
  metadata: Pick<DaemonPidInfo, 'launcher' | 'parentPid'> = {},
  options: DaemonPathOptions = {},
): void {
  const path = getPidPath(options);
  mkdirSync(dirname(path), { recursive: true });
  const info: DaemonPidInfo = {
    pid: process.pid,
    startedAtMs: Date.now(),
    hostname: hostname(),
    ...metadata,
  };
  writeFileSync(path, JSON.stringify(info));
}

export function readPidInfo(options: DaemonPathOptions = {}): DaemonPidInfo | null {
  const path = getPidPath(options);
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

export function readPid(options: DaemonPathOptions = {}): number | null {
  return readPidInfo(options)?.pid ?? null;
}

export function removePid(expectedPid?: number, options: DaemonPathOptions = {}): void {
  try {
    if (expectedPid !== undefined && readPid(options) !== expectedPid) return;
    unlinkSync(getPidPath(options));
  } catch {}
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && Reflect.get(error, 'code') === 'EPERM';
  }
}

interface DaemonStartLock {
  pid: number;
  createdAtMs: number;
  ownerToken?: string;
}

interface DaemonStartLockSnapshot {
  raw: string;
  lock: DaemonStartLock | null;
  device: number;
  inode: number;
  modifiedAtMs: number;
  createdAtMs: number;
  size: number;
}

function parseStartLock(raw: string): DaemonStartLock | null {
  try {
    const parsed = JSON.parse(raw) as DaemonStartLock;
    if (!Number.isFinite(parsed.pid) || !Number.isFinite(parsed.createdAtMs)) return null;
    if (parsed.ownerToken !== undefined && typeof parsed.ownerToken !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function readStartLockSnapshot(options: DaemonPathOptions): DaemonStartLockSnapshot | null {
  try {
    const path = getStartLockPath(options);
    const raw = readFileSync(path, 'utf8');
    const stat = statSync(path);
    return {
      raw,
      lock: parseStartLock(raw),
      device: stat.dev,
      inode: stat.ino,
      modifiedAtMs: stat.mtimeMs,
      createdAtMs: stat.birthtimeMs,
      size: stat.size,
    };
  } catch {
    return null;
  }
}

function sameStartLockSnapshot(
  current: DaemonStartLockSnapshot | null,
  observed: DaemonStartLockSnapshot,
): boolean {
  return (
    current !== null &&
    current.raw === observed.raw &&
    current.device === observed.device &&
    current.inode === observed.inode &&
    current.modifiedAtMs === observed.modifiedAtMs &&
    current.createdAtMs === observed.createdAtMs &&
    current.size === observed.size
  );
}

function removeOwnedStartLock(ownerToken: string, options: DaemonPathOptions): void {
  try {
    if (readStartLockSnapshot(options)?.lock?.ownerToken !== ownerToken) return;
    unlinkSync(getStartLockPath(options));
  } catch {}
}

function staleReclaimKey(snapshot: DaemonStartLockSnapshot): string {
  return createHash('sha256')
    .update(
      [
        snapshot.device,
        snapshot.inode,
        snapshot.modifiedAtMs,
        snapshot.createdAtMs,
        snapshot.size,
        snapshot.raw,
      ].join('\0'),
    )
    .digest('hex');
}

function isStaleStartLock(snapshot: DaemonStartLockSnapshot): boolean {
  // Without parseable ownership metadata there is no safe way to distinguish
  // a crashed writer from a live process paused between create and write.
  return snapshot.lock !== null && !isRunning(snapshot.lock.pid);
}

function claimStaleStartLock(
  observed: DaemonStartLockSnapshot,
  options: DaemonPathOptions,
): boolean {
  const lockPath = getStartLockPath(options);
  const claimPath = `${lockPath}.reclaim-${staleReclaimKey(observed)}`;
  let claimFd: number;
  try {
    claimFd = openSync(claimPath, 'wx');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : null;
    if (code === 'EEXIST') return false;
    throw error;
  }

  try {
    writeFileSync(claimFd, JSON.stringify({ pid: process.pid, ownerToken: randomUUID() }));
  } finally {
    closeSync(claimFd);
  }

  // This tombstone is intentionally retained. It ensures that only one process
  // can ever reclaim this exact stale file instance.
  if (!sameStartLockSnapshot(readStartLockSnapshot(options), observed)) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claims daemon startup using an exclusive-create file, which works on Windows
 * and POSIX without keeping a platform-specific file lock handle open.
 */
export function acquireDaemonStartLock(options: DaemonPathOptions = {}): (() => void) | null {
  const path = getStartLockPath(options);
  mkdirSync(dirname(path), { recursive: true });
  const ownerToken = randomUUID();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      let wroteLock = false;
      try {
        writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, createdAtMs: Date.now(), ownerToken }),
        );
        wroteLock = true;
      } finally {
        closeSync(fd);
        if (!wroteLock) {
          try {
            unlinkSync(path);
          } catch {}
        }
      }
      return () => removeOwnedStartLock(ownerToken, options);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : null;
      if (code !== 'EEXIST') throw error;

      const existing = readStartLockSnapshot(options);
      if (!existing) continue;
      if (!isStaleStartLock(existing)) return null;
      if (!claimStaleStartLock(existing, options)) return null;
    }
  }

  return null;
}
