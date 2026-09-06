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
  /** Preferred boot identity (first of `bootIds` when present). */
  bootId?: string;
  /** All boot identities observed at write time, preferred identity first. */
  bootIds?: string[];
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
  const bootIds = getSystemBootIds();
  const info: DaemonPidInfo = {
    pid,
    startedAtMs: Date.now(),
    hostname: hostname(),
    ...(bootIds[0] ? { bootId: bootIds[0], bootIds } : {}),
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
  /** All identities for the current OS boot; preferred over a single currentBootId. */
  currentBootIds?: string[];
  processCommand?: string | null;
  processRunning?: boolean;
  /** Override for desktop launcher parent liveness checks (tests). */
  parentProcessRunning?: boolean;
  /** Windows LastBootUpTime as Unix ms; used when boot IDs are cross-family. */
  currentBootTimeMs?: number;
}

/** Checks record provenance only; validate each live PID separately before signaling it. */
export function isDaemonPidInfoCurrent(
  info: DaemonPidInfo,
  options: DaemonPidFreshnessOptions = {},
): boolean {
  const currentHostname = options.currentHostname ?? hostname();
  if (info.hostname && info.hostname.toLowerCase() !== currentHostname.toLowerCase()) return false;

  const storedBootIds = storedBootIdentities(info);
  if (storedBootIds.length > 0) {
    const currentBootIds = resolveCurrentBootIds(options);
    const agreement = bootIdentitiesAgree(storedBootIds, currentBootIds);
    if (agreement === 'conflict') return false;
    if (agreement === 'inconclusive' && !recordWrittenAfterBoot(info, options)) return false;
  }

  return true;
}

function storedBootIdentities(info: DaemonPidInfo): string[] {
  const ids: string[] = [];
  if (Array.isArray(info.bootIds)) {
    for (const id of info.bootIds) {
      if (typeof id === 'string' && id.trim()) ids.push(id);
    }
  }
  if (typeof info.bootId === 'string' && info.bootId.trim() && !ids.includes(info.bootId)) {
    ids.push(info.bootId);
  }
  return ids;
}

function resolveCurrentBootIds(options: DaemonPidFreshnessOptions): string[] {
  if (options.currentBootIds && options.currentBootIds.length > 0) {
    return options.currentBootIds.filter((id) => typeof id === 'string' && id.trim());
  }
  if (options.currentBootId !== undefined) {
    return options.currentBootId ? [options.currentBootId] : [];
  }
  return getSystemBootIds();
}

function isWin32TicksId(id: string): boolean {
  return /^win32:\d+$/.test(id);
}

function isWin32RegistryId(id: string): boolean {
  return /^win32:0x[\da-f]+$/i.test(id);
}

// kern.boottime can drift as the wall clock adjusts. Allow at most 1,000 ms for
// old records without a boot-session UUID. This migration heuristic cannot prove
// reboot identity across coincident timestamps or clock rollback; UUIDs can.
const DARWIN_LEGACY_BOOT_DRIFT_US = 1_000_000n;
const DARWIN_BOOT_UUID_PREFIX = 'darwin:bootsessionuuid:';

function darwinBootUuid(id: string): string | null {
  if (!id.startsWith(DARWIN_BOOT_UUID_PREFIX)) return null;
  const uuid = id.slice(DARWIN_BOOT_UUID_PREFIX.length);
  return /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(uuid) ? uuid.toLowerCase() : null;
}

function darwinBootTimeUs(id: string): bigint | null {
  const match = /^darwin:\s*\{\s*sec\s*=\s*(\d+)\s*,\s*usec\s*=\s*(\d+)\s*\}(?:\s.*)?$/.exec(id);
  if (!match) return null;
  const seconds = Number(match[1]);
  const microseconds = Number(match[2]);
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(microseconds)) return null;
  if (microseconds > 999_999) return null;
  return BigInt(seconds) * 1_000_000n + BigInt(microseconds);
}

/** Probe independently so older systems or a failed sysctl retain usable evidence. */
export function readDarwinBootIdentities(
  options: { readSysctl?: (name: string) => string } = {},
): string[] {
  const readSysctl =
    options.readSysctl ??
    ((name: string) =>
      execFileSync('/usr/sbin/sysctl', ['-n', name], { encoding: 'utf8', timeout: 1_000 }));
  const ids: string[] = [];
  try {
    const id = `${DARWIN_BOOT_UUID_PREFIX}${readSysctl('kern.bootsessionuuid').trim()}`;
    const uuid = darwinBootUuid(id);
    if (uuid) ids.push(`${DARWIN_BOOT_UUID_PREFIX}${uuid}`);
  } catch {}
  try {
    const id = `darwin:${readSysctl('kern.boottime').trim()}`;
    if (darwinBootTimeUs(id) !== null) ids.push(id);
  } catch {}
  return ids;
}

function recordWrittenAfterBoot(info: DaemonPidInfo, options: DaemonPidFreshnessOptions): boolean {
  return (
    Number.isFinite(info.startedAtMs) &&
    Number.isFinite(options.currentBootTimeMs) &&
    (info.startedAtMs as number) >= (options.currentBootTimeMs as number)
  );
}

/**
 * Ticks are authoritative when both sides have them (reboot changes ticks even if
 * a registry BootId collides). Same-family registry is used for legacy PID files.
 * Cross-family-only comparisons are inconclusive — callers may accept via
 * record startedAtMs >= currentBootTimeMs instead of treating families as interchangeable.
 */
function bootIdentitiesAgree(
  stored: string[],
  current: string[],
): 'match' | 'conflict' | 'inconclusive' {
  const storedTicks = stored.filter(isWin32TicksId);
  const currentTicks = current.filter(isWin32TicksId);
  if (storedTicks.length > 0 && currentTicks.length > 0) {
    return storedTicks.some((id) => currentTicks.includes(id)) ? 'match' : 'conflict';
  }

  const storedReg = stored.filter(isWin32RegistryId);
  const currentReg = current.filter(isWin32RegistryId);
  if (storedReg.length > 0 && currentReg.length > 0) {
    return storedReg.some((id) => currentReg.includes(id)) ? 'match' : 'conflict';
  }

  const storedDarwin = stored.filter((id) => id.startsWith('darwin:'));
  const currentDarwin = current.filter((id) => id.startsWith('darwin:'));
  if (storedDarwin.length > 0 || currentDarwin.length > 0) {
    const storedUuids = storedDarwin.map(darwinBootUuid).filter((id) => id !== null);
    const currentUuids = currentDarwin.map(darwinBootUuid).filter((id) => id !== null);
    if (storedUuids.length > 0 && currentUuids.length > 0) {
      return storedUuids.some((id) => currentUuids.includes(id)) ? 'match' : 'conflict';
    }
    const storedTimes = storedDarwin.map(darwinBootTimeUs).filter((time) => time !== null);
    const currentTimes = currentDarwin.map(darwinBootTimeUs).filter((time) => time !== null);
    return storedTimes.some((storedTime) =>
      currentTimes.some((currentTime) => {
        const difference = storedTime - currentTime;
        return (
          difference >= -DARWIN_LEGACY_BOOT_DRIFT_US && difference <= DARWIN_LEGACY_BOOT_DRIFT_US
        );
      }),
    )
      ? 'match'
      : 'conflict';
  }

  if (stored.length === 0 || current.length === 0) return 'inconclusive';

  const storedOther = stored.filter((id) => !isWin32TicksId(id) && !isWin32RegistryId(id));
  const currentOther = current.filter((id) => !isWin32TicksId(id) && !isWin32RegistryId(id));
  if (storedOther.length > 0 && currentOther.length > 0) {
    const currentSet = new Set(currentOther);
    return storedOther.some((id) => currentSet.has(id)) ? 'match' : 'conflict';
  }

  return 'inconclusive';
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

const WINDOWS_DESKTOP_DAEMON_PROBE = String.raw`
$ErrorActionPreference = 'Stop'
$result = [ordered]@{
  selectedEnv = $null
  pidInfo = $null
  currentHostname = [System.Net.Dns]::GetHostName()
  currentBootId = $null
  currentBootIds = [System.Collections.Generic.List[string]]::new()
  processRunning = $false
  processCommand = $null
  parentProcessRunning = $false
  currentBootTimeMs = $null
}

try {
  $prefPath = Join-Path $env:APPDATA 'Agendex\agendex-windows-env.json'
  if (Test-Path -LiteralPath $prefPath) {
    $pref = Get-Content -LiteralPath $prefPath -Raw | ConvertFrom-Json
    $result.selectedEnv = $pref.env
  }

  if ($result.selectedEnv -eq 'wsl') {
    $configDir = Join-Path $env:USERPROFILE '__AGENDEX_CONFIG_DIR_NAME__'
    $pidPath = Join-Path $configDir 'daemon.pid'
    if (Test-Path -LiteralPath $pidPath) {
      $info = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
      $result.pidInfo = $info

      # Canonical identity is LastBootUpTime ticks (what new PID files store).
      # Also collect registry BootId so a still-running older desktop daemon whose
      # PID file has win32:0x... still overlaps until it restarts and rewrites.
      try {
        $bootUtc = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
        $result.currentBootTimeMs = [int64]([DateTimeOffset]$bootUtc).ToUnixTimeMilliseconds()
        $lastBoot = $bootUtc.Ticks
        if ($lastBoot) {
          $ticksId = "win32:$lastBoot"
          $result.currentBootIds.Add($ticksId) | Out-Null
          $result.currentBootId = $ticksId
        }
      } catch {}
      try {
        $regOut = (& reg.exe query 'HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters' /v BootId 2>$null | Out-String)
        if ($regOut -match 'BootId\s+REG_DWORD\s+(0x[\da-f]+)') {
          $regId = 'win32:' + $Matches[1].ToLower()
          if (-not $result.currentBootIds.Contains($regId)) {
            $result.currentBootIds.Add($regId) | Out-Null
          }
          if (-not $result.currentBootId) { $result.currentBootId = $regId }
        }
      } catch {}

      $pidValue = 0
      $process = $null
      if ([int]::TryParse([string]$info.pid, [ref]$pidValue) -and $pidValue -gt 0) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
        if ($null -ne $process) {
          $result.processRunning = $true
          $result.processCommand = [string]$process.CommandLine
        }
      }

      $parentPidValue = 0
      if ([int]::TryParse([string]$info.parentPid, [ref]$parentPidValue) -and $parentPidValue -gt 0) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentPidValue" -ErrorAction SilentlyContinue
        # Require the live worker's ParentProcessId to match — PID existence alone
        # accepts recycled worker PIDs paired with an unrelated live parent PID.
        if ($null -ne $parent -and $null -ne $process) {
          $result.parentProcessRunning = ([int]$process.ParentProcessId -eq $parentPidValue)
        } else {
          $result.parentProcessRunning = $null -ne $parent
        }
      }
    }
  }
} catch {}

$result | ConvertTo-Json -Compress -Depth 4
`;

function probeWindowsDesktopDaemon(configDirName: string): string | null {
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        WINDOWS_DESKTOP_DAEMON_PROBE.replace('__AGENDEX_CONFIG_DIR_NAME__', configDirName),
      ],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    ).trim();
  } catch {
    return null;
  }
}

export function readWindowsDesktopDaemonInfoFromWsl(
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    dev?: boolean;
    runProbe?: (configDirName: string) => string | null;
  } = {},
): DaemonPidInfo | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'linux' || !(env.WSL_DISTRO_NAME?.trim() || env.WSL_INTEROP?.trim())) {
    return null;
  }

  const raw = (options.runProbe ?? probeWindowsDesktopDaemon)(
    options.dev ? '.agendex-dev' : '.agendex',
  );
  if (!raw) return null;

  try {
    const probe = JSON.parse(raw) as Record<string, unknown>;
    if (probe.selectedEnv !== 'wsl' || !isRecord(probe.pidInfo)) return null;

    const info = daemonPidInfoFromRecord(probe.pidInfo);
    if (!info || info.launcher !== 'desktop') return null;
    if (typeof probe.currentHostname !== 'string' || !probe.currentHostname.trim()) return null;
    const currentBootIds = parseBootIdList(probe.currentBootIds);
    if (currentBootIds.length === 0 && typeof probe.currentBootId === 'string') {
      currentBootIds.push(probe.currentBootId);
    }
    // Desktop records must include boot identity so reboot boundaries stay enforceable.
    if (storedBootIdentities(info).length === 0 || currentBootIds.length === 0) return null;
    if (typeof probe.processRunning !== 'boolean') return null;
    if (probe.processCommand !== null && typeof probe.processCommand !== 'string') return null;
    if (typeof probe.parentProcessRunning !== 'boolean') return null;
    if (
      probe.currentBootTimeMs !== undefined &&
      probe.currentBootTimeMs !== null &&
      !Number.isFinite(probe.currentBootTimeMs)
    ) {
      return null;
    }

    return isDaemonPidInfoRunning(info, {
      currentHostname: probe.currentHostname,
      currentBootIds,
      processRunning: probe.processRunning,
      processCommand: probe.processCommand,
      parentProcessRunning: probe.parentProcessRunning,
      currentBootTimeMs:
        typeof probe.currentBootTimeMs === 'number' ? probe.currentBootTimeMs : undefined,
    })
      ? info
      : null;
  } catch {
    return null;
  }
}

export function isAgendexDaemonProcess(pid: number): boolean {
  return isRunning(pid) && isAgendexDaemonCommand(readProcessCommand(pid));
}

export function getDaemonBootId(): string | null {
  return getSystemBootId();
}

function getSystemBootId(): string | null {
  return getSystemBootIds()[0] ?? null;
}

let cachedBootIds: string[] | undefined;

function getSystemBootIds(): string[] {
  if (cachedBootIds !== undefined) return cachedBootIds;

  try {
    if (process.platform === 'linux') {
      cachedBootIds = [`linux:${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}`];
    } else if (process.platform === 'darwin') {
      cachedBootIds = readDarwinBootIdentities();
    } else if (process.platform === 'win32') {
      cachedBootIds = readWindowsBootIdentities();
    } else {
      cachedBootIds = [];
    }
  } catch {
    cachedBootIds = [];
  }

  cachedBootId = cachedBootIds[0] ?? null;
  return cachedBootIds;
}

function readWindowsBootIdentities(): string[] {
  // Single canonical identity (LastBootUpTime ticks). Mixing registry BootId with
  // ticks let writer and WSL probe disagree for the same boot under overlap checks.
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
    return lastBoot ? [`win32:${lastBoot}`] : [];
  } catch {
    return [];
  }
}

function parseBootIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim() && !ids.includes(entry)) ids.push(entry);
  }
  return ids;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function daemonPidInfoFromRecord(value: Record<string, unknown>): DaemonPidInfo | null {
  if (!Number.isFinite(value.pid) || (value.pid as number) <= 0) return null;
  const info: DaemonPidInfo = { pid: value.pid as number };
  if (Number.isFinite(value.startedAtMs)) info.startedAtMs = value.startedAtMs as number;
  if (typeof value.hostname === 'string') info.hostname = value.hostname;
  if (value.launcher === 'cli' || value.launcher === 'desktop') info.launcher = value.launcher;
  if (Number.isFinite(value.parentPid)) info.parentPid = value.parentPid as number;
  if (Number.isFinite(value.workerPid)) info.workerPid = value.workerPid as number;
  if (typeof value.ready === 'boolean') info.ready = value.ready;
  if (typeof value.bootId === 'string') info.bootId = value.bootId;
  const bootIds = parseBootIdList(value.bootIds);
  if (bootIds.length > 0) info.bootIds = bootIds;
  return info;
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
