import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
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

function getStopRequestPath(pid: number, options: DaemonPathOptions): string {
  return join(resolveConfigDir(options), `daemon.stop-${pid}`);
}

const INVALID_START_LOCK_STALE_MS = 15_000;
const START_LOCK_LEASE_MS = 30_000;
const START_LOCK_HEARTBEAT_MS = 5_000;
let cachedBootId: string | null | undefined;

export interface DaemonPidInfo {
  pid: number;
  startedAtMs?: number;
  hostname?: string;
  launcher?: 'cli' | 'desktop';
  parentPid?: number;
  workerPid?: number;
  ready?: boolean;
  bootId?: string;
}

export function writePid(
  metadata: Pick<DaemonPidInfo, 'launcher' | 'parentPid' | 'workerPid' | 'ready'> = {},
  options: DaemonPathOptions = {},
): void {
  writePidForProcess(process.pid, metadata, options);
}

export function writePidForProcess(
  pid: number,
  metadata: Pick<DaemonPidInfo, 'launcher' | 'parentPid' | 'workerPid' | 'ready'> = {},
  options: DaemonPathOptions = {},
): void {
  const path = getPidPath(options);
  mkdirSync(dirname(path), { recursive: true });
  const bootId = getSystemBootId();
  const info: DaemonPidInfo = {
    pid,
    startedAtMs: Date.now(),
    hostname: hostname(),
    ...(bootId ? { bootId } : {}),
    ...metadata,
  };
  const candidatePath = `${path}.candidate-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(candidatePath, JSON.stringify(info), { flag: 'wx' });
    renameSync(candidatePath, path);
  } finally {
    try {
      unlinkSync(candidatePath);
    } catch {}
  }
}

export function readPidInfo(options: DaemonPathOptions = {}): DaemonPidInfo | null {
  const path = getPidPath(options);
  let raw: string;
  let fileUpdatedAtMs: number;
  try {
    if (!existsSync(path)) return null;
    raw = readFileSync(path, 'utf-8').trim();
    fileUpdatedAtMs = statSync(path).mtimeMs;
  } catch {
    return null;
  }

  // Legacy format: bare PID number
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0 && !raw.startsWith('{')) {
    return { pid: asNumber, startedAtMs: fileUpdatedAtMs, hostname: hostname() };
  }

  // New format: JSON
  try {
    const parsed = JSON.parse(raw) as DaemonPidInfo;
    if (Number.isFinite(parsed.pid) && parsed.pid > 0) {
      return {
        ...parsed,
        startedAtMs: Number.isFinite(parsed.startedAtMs) ? parsed.startedAtMs : fileUpdatedAtMs,
        hostname:
          typeof parsed.hostname === 'string' && parsed.hostname.trim()
            ? parsed.hostname
            : hostname(),
      };
    }
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

export interface DaemonPidFreshnessOptions {
  currentHostname?: string;
  currentBootId?: string | null;
  processCommand?: string | null;
  processRunning?: boolean;
  /** Override for desktop launcher parent liveness checks (tests). */
  parentProcessRunning?: boolean;
}

/** Checks record provenance only; validate each live PID separately before signaling it. */
export function isDaemonPidInfoCurrent(
  info: DaemonPidInfo,
  options: DaemonPidFreshnessOptions = {},
): boolean {
  const currentHostname = options.currentHostname ?? hostname();
  if (info.hostname && info.hostname.toLowerCase() !== currentHostname.toLowerCase()) return false;

  const currentBootId = options.currentBootId ?? getSystemBootId();
  if (info.bootId && currentBootId && info.bootId !== currentBootId) return false;

  return true;
}

export function isDaemonPidInfoRunning(
  info: DaemonPidInfo,
  options: DaemonPidFreshnessOptions = {},
): boolean {
  if (!isDaemonPidInfoCurrent(info, options)) return false;
  const running = options.processRunning ?? isRunning(info.pid);
  if (!running) return false;
  const command =
    options.processCommand !== undefined ? options.processCommand : readProcessCommand(info.pid);
  if (isAgendexDaemonCommand(command)) return true;

  // Electron utilityProcess.fork Node args are process.argv inside the worker, but often
  // do not appear in OS process listings (`ps` / WMI). Trust desktop pid-file provenance
  // while the recorded Electron parent is still alive and the live process still looks
  // like an Electron utility worker — avoids false "not running" in `agendex status`.
  return isDesktopDaemonOwnership(info, command, options);
}

export function isAgendexDaemonProcess(pid: number): boolean {
  return isRunning(pid) && isAgendexDaemonCommand(readProcessCommand(pid));
}

export function getDaemonBootId(): string | null {
  return getSystemBootId();
}

function getSystemBootId(): string | null {
  if (cachedBootId !== undefined) return cachedBootId;

  try {
    if (process.platform === 'linux') {
      cachedBootId = `linux:${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}`;
    } else if (process.platform === 'darwin') {
      cachedBootId = `darwin:${execFileSync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], {
        encoding: 'utf8',
        timeout: 1_000,
      }).trim()}`;
    } else if (process.platform === 'win32') {
      cachedBootId = readWindowsBootId();
    } else {
      cachedBootId = null;
    }
  } catch {
    cachedBootId = null;
  }

  return cachedBootId;
}

function readWindowsBootId(): string | null {
  try {
    const registry = execFileSync(
      'reg.exe',
      [
        'query',
        String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters`,
        '/v',
        'BootId',
      ],
      { encoding: 'utf8', timeout: 1_000, windowsHide: true },
    );
    const bootId = registry.match(/BootId\s+REG_DWORD\s+(0x[\da-f]+)/i)?.[1];
    if (bootId) return `win32:${bootId.toLowerCase()}`;
  } catch {}

  try {
    const lastBoot = execFileSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks',
      ],
      { encoding: 'utf8', timeout: 1_000, windowsHide: true },
    ).trim();
    return lastBoot ? `win32:${lastBoot}` : null;
  } catch {
    return null;
  }
}

function readProcessCommand(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'linux') {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
    }
    if (process.platform === 'darwin') {
      return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 1_000,
      }).trim();
    }
    if (process.platform === 'win32') {
      return execFileSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ],
        { encoding: 'utf8', timeout: 3_000, windowsHide: true },
      ).trim();
    }
  } catch {}
  return null;
}

function isAgendexDaemonCommand(command: string | null): boolean {
  if (!command) return false;
  const normalized = command.toLowerCase();
  if (normalized.includes('--agendex-daemon-worker') || normalized.includes('daemon-worker')) {
    return true;
  }
  if (!normalized.includes('agendex')) return false;
  return normalized.includes('--daemon') || normalized.includes('--worker');
}

function isElectronUtilityCommand(command: string | null): boolean {
  if (!command) return false;
  // Node utilityProcess.fork workers only — not Chromium network/audio/GPU helpers.
  return command.toLowerCase().includes('--utility-sub-type=node.mojom.nodeservice');
}

function isDesktopDaemonOwnership(
  info: DaemonPidInfo,
  command: string | null,
  options: DaemonPidFreshnessOptions,
): boolean {
  if (info.launcher !== 'desktop') return false;
  if (!Number.isInteger(info.parentPid) || (info.parentPid as number) <= 0) return false;
  const parentRunning = options.parentProcessRunning ?? isRunning(info.parentPid as number);
  if (!parentRunning) return false;
  return isElectronUtilityCommand(command);
}

export function requestDaemonStop(pid: number, options: DaemonPathOptions = {}): void {
  const path = getStopRequestPath(pid, options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '', { flag: 'w' });
}

export function consumeDaemonStopRequest(pid: number, options: DaemonPathOptions = {}): boolean {
  try {
    unlinkSync(getStopRequestPath(pid, options));
    return true;
  } catch {
    return false;
  }
}

export function clearDaemonStopRequest(pid: number, options: DaemonPathOptions = {}): void {
  try {
    unlinkSync(getStopRequestPath(pid, options));
  } catch {}
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
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0 || !Number.isFinite(parsed.createdAtMs)) {
      return null;
    }
    if (parsed.ownerToken !== undefined && typeof parsed.ownerToken !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function readStartLockSnapshot(options: DaemonPathOptions): DaemonStartLockSnapshot | null {
  return readFileSnapshot(getStartLockPath(options));
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
  removeOwnedFile(getStartLockPath(options), ownerToken);
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
  if (snapshot.lock) {
    return (
      !isRunning(snapshot.lock.pid) || Date.now() - snapshot.modifiedAtMs > START_LOCK_LEASE_MS
    );
  }
  return Date.now() - snapshot.modifiedAtMs > INVALID_START_LOCK_STALE_MS;
}

function claimStaleStartLock(
  observed: DaemonStartLockSnapshot,
  options: DaemonPathOptions,
): 'reclaimed' | 'retry' | 'blocked' {
  const lockPath = getStartLockPath(options);
  const claimPath = `${lockPath}.reclaim-${staleReclaimKey(observed)}`;
  const ownerToken = randomUUID();
  if (!publishOwnedFile(claimPath, ownerToken)) {
    const existingClaim = readFileSnapshot(claimPath);
    if (existingClaim && isStaleStartLock(existingClaim)) {
      // A previous reclaimer died mid-operation. Remove its claim and make
      // callers retry; any replacement owner verifies its token before it can
      // unlink the stale startup lock.
      try {
        unlinkSync(claimPath);
      } catch {}
      return 'retry';
    }
    return 'blocked';
  }

  try {
    if (!sameStartLockSnapshot(readStartLockSnapshot(options), observed)) return 'retry';
    if (readFileSnapshot(claimPath)?.lock?.ownerToken !== ownerToken) return 'retry';
    unlinkSync(lockPath);
    return 'reclaimed';
  } catch {
    return 'retry';
  } finally {
    removeOwnedFile(claimPath, ownerToken);
  }
}

function readFileSnapshot(path: string): DaemonStartLockSnapshot | null {
  try {
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

function removeOwnedFile(path: string, ownerToken: string): void {
  try {
    if (readFileSnapshot(path)?.lock?.ownerToken !== ownerToken) return;
    unlinkSync(path);
  } catch {}
}

function publishOwnedFile(path: string, ownerToken: string): boolean {
  const candidatePath = `${path}.candidate-${ownerToken}`;
  try {
    writeFileSync(
      candidatePath,
      JSON.stringify({ pid: process.pid, createdAtMs: Date.now(), ownerToken }),
      { flag: 'wx' },
    );
    try {
      linkSync(candidatePath, path);
      return true;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : null;
      if (code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    try {
      unlinkSync(candidatePath);
    } catch {}
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
    if (publishOwnedFile(path, ownerToken)) {
      const heartbeat = setInterval(() => {
        try {
          if (readStartLockSnapshot(options)?.lock?.ownerToken !== ownerToken) return;
          const now = new Date();
          utimesSync(path, now, now);
        } catch {}
      }, START_LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      return () => {
        clearInterval(heartbeat);
        removeOwnedStartLock(ownerToken, options);
      };
    }

    const existing = readStartLockSnapshot(options);
    if (!existing) continue;
    if (!isStaleStartLock(existing)) return null;
    if (claimStaleStartLock(existing, options) === 'blocked') return null;
  }

  return null;
}
