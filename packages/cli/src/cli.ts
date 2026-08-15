#!/usr/bin/env node

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_CONFIG_VERSION,
  getConfigPath,
  loadConfig,
  loadOrInitConfig,
  normalizeCustomPlanDirs,
  removeCustomPlanDir,
  resolveCustomPlanDirPath,
  setDevMode,
  updateConfig,
} from '@agendex/shared';
import { CLI_DAEMON_STALE_AFTER_MS } from '@agendex/shared/daemon-status';
import type { DeviceInfo } from './api.ts';
import { AuthExpiredError, deleteDaemons, fetchDevices, sendShutdown } from './api.ts';
import { login, logout } from './auth.ts';
import { runCapturePlanCommand } from './capture-plan.ts';
import { renderHelp } from './help.ts';
import { requestWorkerShutdown, runWorker, startSupervisor } from './daemon.ts';
import { runHookReviewCommand, runHooksCommand } from './hooks.ts';
import { writeStderr, writeStdout } from './stdio.ts';
import {
  acquireDaemonStartLock,
  isAgendexDaemonProcess,
  isDaemonPidInfoCurrent,
  isDaemonPidInfoRunning,
  isRunning,
  readPidInfo,
  removePid,
  requestDaemonStop,
  writePidForProcess,
} from './pid.ts';
import { renderStatus, type CloudDaemonStatusError } from './status.ts';
import { syncAll } from './sync.ts';
import { runDownload } from './download.ts';
import { runUpgrade } from './upgrade.ts';
import { runUpload } from './upload.ts';
import { CLI_VERSION, checkForUpdate } from './version.ts';
import { openAgendexWeb, openSharedPlan } from './web.ts';

const args = process.argv.slice(2);
const devFlag = args.includes('--dev');
if (devFlag) setDevMode(true);

/** Global flags that may appear before the subcommand; excluded from command resolution. */
function firstCommandToken(argv: string[]): string | undefined {
  for (const a of argv) {
    if (a === '--dev') continue;
    return a;
  }
  return undefined;
}

const command = firstCommandToken(args) ?? 'start';
const cliEntry = resolve(process.argv[1] ?? fileURLToPath(import.meta.url));
const DAEMON_START_TIMEOUT_MS = 30_000;
const DAEMON_ORPHAN_DRAIN_TIMEOUT_MS = 3_000;
const DAEMON_START_CLEANUP_TIMEOUT_MS = 4_000;
const DAEMON_START_FORCE_KILL_TIMEOUT_MS = 2_000;

async function main(): Promise<number> {
  const isInternal = args.includes('--daemon') || args.includes('--worker');
  if (command === '--version' || command === '-v') {
    writeStdout(CLI_VERSION);
    return 0;
  }

  if (command === 'help' || args.includes('--help') || args.includes('-h')) {
    writeStdout(renderHelp({ cliVersion: CLI_VERSION }));
    return 0;
  }

  const isPassthrough = [
    'stop',
    'status',
    'login',
    'logout',
    'open',
    'view',
    'cleanup',
    'hooks',
    'review-plan',
    'capture-plan',
    'add-dir',
    'remove-dir',
    'list-dirs',
    'upload',
    'download',
    'upgrade',
    'help',
    '--help',
    '-h',
  ].includes(command);

  if (!isInternal && !isPassthrough) {
    const { checked, updateAvailable, current, latest } = await checkForUpdate();
    if (checked && updateAvailable) {
      // Intentionally advisory: old clients can still run unless a specific command hits
      // an explicit server/client compatibility failure.
      writeStderr(`[agendex] update available: v${current} → v${latest}`);
      writeStderr(`[agendex] run: agendex upgrade`);
    }
  }

  switch (command) {
    case 'open': {
      const urlIdx = args.indexOf('--url');
      const siteUrl = urlIdx !== -1 ? args[urlIdx + 1] : undefined;
      await openAgendexWeb(siteUrl);
      return 0;
    }

    case 'view': {
      const url = args.find((a) => a !== 'view' && a !== '--dev' && !a.startsWith('--'));
      if (!url) {
        writeStderr('[agendex] usage: agendex view <shared-plan-url>');
        return 1;
      }
      if (!(await openSharedPlan(url))) return 1;
      return 0;
    }

    case 'start': {
      if (args.includes('--daemon')) {
        await startSupervisor();
        return 0;
      }

      if (args.includes('--worker')) {
        const supervisorPid = Number(process.env.AGENDEX_DAEMON_SUPERVISOR_PID);
        const supervisorWatchdog =
          Number.isInteger(supervisorPid) && supervisorPid > 0
            ? setInterval(() => {
                if (!isRunning(supervisorPid)) void requestWorkerShutdown({ skipRemote: true });
              }, 250)
            : null;
        supervisorWatchdog?.unref();
        try {
          await runWorker({
            onReady: () => {
              const readyDelayMs = Number(process.env.AGENDEX_DAEMON_READY_DELAY_MS ?? 0);
              const reportReady = () => process.send?.({ type: 'ready' });
              if (Number.isFinite(readyDelayMs) && readyDelayMs > 0) {
                setTimeout(reportReady, readyDelayMs);
              } else {
                reportReady();
              }
            },
          });
        } finally {
          if (supervisorWatchdog) clearInterval(supervisorWatchdog);
        }
        return 0;
      }

      const releaseStartLock =
        acquireDaemonStartLock() ?? (await waitForDaemonStartLock(DAEMON_START_TIMEOUT_MS));
      if (!releaseStartLock) {
        writeStderr('[agendex] daemon startup is already in progress');
        return 1;
      }

      try {
        const current = readPidInfo();
        const currentPid = current?.pid ?? null;
        const currentPidInfoIsTrusted = current ? isDaemonPidInfoCurrent(current) : false;
        if (current && isDaemonPidInfoRunning(current)) {
          const desktopOrphan =
            current?.launcher === 'desktop' &&
            current.parentPid !== undefined &&
            !isRunning(current.parentPid);
          if (
            !desktopOrphan ||
            !(await waitForProcessExit(current.pid, DAEMON_ORPHAN_DRAIN_TIMEOUT_MS))
          ) {
            if (desktopOrphan) {
              writeStderr('[agendex] previous desktop daemon worker is still shutting down');
              return 1;
            }
            writeStdout(`[agendex] daemon already running (PID ${currentPid})`);
            return 0;
          }
        }
        if (
          currentPidInfoIsTrusted &&
          current?.launcher === 'cli' &&
          Number.isInteger(current.workerPid) &&
          (current.workerPid as number) > 0 &&
          isAgendexDaemonProcess(current.workerPid as number) &&
          !(await waitForProcessExit(current.workerPid as number, DAEMON_ORPHAN_DRAIN_TIMEOUT_MS))
        ) {
          writeStderr('[agendex] previous daemon worker is still shutting down');
          return 1;
        }
        if (currentPid) removePid(currentPid);

        const daemonArgs = [cliEntry, 'start', '--daemon'];
        if (devFlag) daemonArgs.push('--dev');

        const child = spawn(process.execPath, daemonArgs, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, ...(devFlag ? { AGENDEX_DEV: '1' } : {}) },
        });
        const pid = await waitForSpawnedDaemon(child, DAEMON_START_TIMEOUT_MS);
        if (!pid) {
          const stopped = await stopFailedDaemonStart(child);
          if (child.pid && stopped) {
            removePid(child.pid);
          } else if (child.pid) {
            const current = readPidInfo();
            writePidForProcess(child.pid, {
              launcher: 'cli',
              ...(current?.pid === child.pid && current.workerPid
                ? { workerPid: current.workerPid }
                : {}),
              ...(current?.pid === child.pid && current.ready !== undefined
                ? { ready: current.ready }
                : { ready: false }),
            });
            child.unref();
          }
          writeStderr(
            stopped
              ? '[agendex] daemon failed to start'
              : '[agendex] daemon failed to start and could not be terminated',
          );
          return 1;
        }
        child.unref();
        writeStdout(`[agendex] daemon started (PID ${pid})`);
        return 0;
      } finally {
        releaseStartLock();
      }
    }

    case 'stop': {
      const releaseStartLock = await waitForDaemonStartLock(DAEMON_START_TIMEOUT_MS);
      if (!releaseStartLock) {
        writeStderr('[agendex] daemon startup is still in progress');
        return 1;
      }

      try {
        const pidInfo = readPidInfo();
        const pid = pidInfo?.pid ?? null;
        if (!pidInfo || !isDaemonPidInfoRunning(pidInfo)) {
          const workerPid = pidInfo?.workerPid;
          const ownedWorkerIsRunning =
            pidInfo?.launcher === 'cli' &&
            isDaemonPidInfoCurrent(pidInfo) &&
            Number.isInteger(workerPid) &&
            (workerPid as number) > 0 &&
            isAgendexDaemonProcess(workerPid as number);
          if (
            ownedWorkerIsRunning &&
            !(await waitForProcessExit(workerPid as number, DAEMON_ORPHAN_DRAIN_TIMEOUT_MS))
          ) {
            writeStderr('[agendex] daemon worker is still shutting down');
            return 1;
          }
          if (pid) removePid(pid);
          writeStdout('[agendex] daemon is not running');
          return 0;
        }
        const runningPid = pidInfo.pid;

        if (process.platform === 'win32') {
          requestDaemonStop(runningPid);
        } else {
          process.kill(runningPid, 'SIGTERM');
        }
        const stopped = await waitForProcessExit(runningPid, 5_000);

        if (!stopped) {
          writeStderr('[agendex] daemon did not stop in time');
          return 1;
        }

        const workerPid = pidInfo.workerPid;
        if (
          Number.isInteger(workerPid) &&
          (workerPid as number) > 0 &&
          isAgendexDaemonProcess(workerPid as number) &&
          !(await waitForProcessExit(workerPid as number, DAEMON_ORPHAN_DRAIN_TIMEOUT_MS))
        ) {
          writeStderr('[agendex] daemon worker did not stop in time');
          return 1;
        }

        removePid(runningPid);
        await sendShutdown();
        writeStdout(`[agendex] daemon stopped (PID ${runningPid})`);
        return 0;
      } finally {
        releaseStartLock();
      }
    }

    case 'login': {
      const urlIdx = args.indexOf('--url');
      const siteUrl = urlIdx !== -1 ? args[urlIdx + 1] : undefined;
      await login(siteUrl);
      return 0;
    }

    case 'logout': {
      logout();
      return 0;
    }

    case 'configure': {
      const config = await loadOrInitConfig({ configureAdapters: true });
      writeStdout(`[agendex] adapters updated: ${config.enabledAdapters.join(', ')}`);
      return 0;
    }

    case 'sync': {
      const force = args.includes('--force');
      await syncAll(force);
      return 0;
    }

    case 'upload': {
      return runUpload(args);
    }

    case 'download': {
      return runDownload(args);
    }

    case 'hooks': {
      return runHooksCommand(args, cliEntry);
    }

    case 'review-plan': {
      return runHookReviewCommand(args);
    }

    case 'capture-plan': {
      const result = await runCapturePlanCommand(args);
      if (result === 0) writeStdout('{}');
      return result;
    }

    case 'cleanup': {
      return runCleanupCommand(args);
    }

    case 'add-dir': {
      return runAddDirCommand(args);
    }

    case 'remove-dir': {
      return runRemoveDirCommand(args);
    }

    case 'list-dirs': {
      const cfg = loadConfig();
      const dirs = cfg?.customPlanDirs ?? [];
      if (dirs.length === 0) {
        writeStdout('[agendex] no custom plan directories configured');
      } else {
        writeStdout(`[agendex] custom plan directories (${dirs.length}):`);
        for (const dir of dirs) {
          writeStdout(`  - ${dir}`);
        }
      }
      return 0;
    }

    case 'status': {
      const config = loadConfig();
      const pidInfo = readPidInfo();
      const running = pidInfo ? isDaemonPidInfoRunning(pidInfo) : false;
      let devices: DeviceInfo[] | null = null;
      let cloudDaemonError: CloudDaemonStatusError | null = null;

      if (config?.cloudToken && config?.convexUrl) {
        try {
          devices = await fetchDevices();
        } catch (err) {
          if (err instanceof AuthExpiredError) {
            cloudDaemonError = { kind: 'auth-expired' };
          } else {
            cloudDaemonError = {
              kind: 'unavailable',
              message: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }

      writeStdout(
        renderStatus({
          config,
          configPath: getConfigPath(),
          pidInfo,
          running,
          cliVersion: CLI_VERSION,
          devices,
          cloudDaemonError,
        }),
      );
      return 0;
    }

    case 'upgrade': {
      return runUpgrade({ force: args.includes('--force') });
    }

    default: {
      writeStderr(`Unknown command: ${command}`);
      writeStderr(`Run "agendex help" for usage.`);
      return 1;
    }
  }
}

function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(() => {
      if (!isRunning(pid)) {
        clearInterval(interval);
        resolve(true);
        return;
      }

      if (Date.now() >= deadline) {
        clearInterval(interval);
        resolve(false);
      }
    }, 200);
  });
}

async function stopFailedDaemonStart(child: ChildProcess): Promise<boolean> {
  const pid = child.pid;
  if (!pid) return true;
  const observed = readPidInfo();
  const workerPid = observed?.pid === pid ? observed.workerPid : undefined;

  if (child.exitCode === null && child.signalCode === null && isRunning(pid)) {
    if (process.platform === 'win32') requestDaemonStop(pid);
    else child.kill('SIGTERM');
    if (!(await waitForProcessExit(pid, DAEMON_START_CLEANUP_TIMEOUT_MS))) {
      child.kill('SIGKILL');
      if (!(await waitForProcessExit(pid, DAEMON_START_FORCE_KILL_TIMEOUT_MS))) return false;
    }
  }

  if (!workerPid || !isAgendexDaemonProcess(workerPid)) return true;
  if (await waitForDaemonProcessExit(workerPid, DAEMON_START_FORCE_KILL_TIMEOUT_MS)) return true;
  if (!isAgendexDaemonProcess(workerPid)) return true;
  try {
    process.kill(workerPid, 'SIGKILL');
  } catch {}
  return await waitForDaemonProcessExit(workerPid, DAEMON_START_FORCE_KILL_TIMEOUT_MS);
}

function waitForDaemonProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (!isAgendexDaemonProcess(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function waitForDaemonStartLock(timeoutMs: number): Promise<(() => void) | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const release = acquireDaemonStartLock();
    if (release) return release;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  return null;
}

async function waitForSpawnedDaemon(
  child: ChildProcess,
  timeoutMs: number,
): Promise<number | null> {
  let spawnError: Error | null = null;
  child.once('error', (error) => {
    spawnError = error;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) return null;
    const pidInfo = readPidInfo();
    if (
      pidInfo &&
      pidInfo.pid === child.pid &&
      pidInfo.ready === true &&
      isDaemonPidInfoRunning(pidInfo) &&
      Number.isInteger(pidInfo.workerPid) &&
      (pidInfo.workerPid as number) > 0 &&
      isAgendexDaemonProcess(pidInfo.workerPid as number)
    ) {
      return pidInfo.pid;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  return null;
}

async function runCleanupCommand(commandArgs: string[]): Promise<number> {
  const config = loadConfig();
  if (!config?.cloudToken || !config?.convexUrl) {
    writeStderr('[agendex] not logged in. Run `agendex login` first.');
    return 1;
  }

  let allDevices: DeviceInfo[];
  try {
    allDevices = await fetchDevices();
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      writeStderr('[agendex] cloud token expired. Run `agendex login` to re-authenticate.');
      return 1;
    }
    throw err;
  }
  if (allDevices.length === 0) {
    writeStdout('[agendex] no daemons found');
    return 0;
  }

  const now = Date.now();
  const staleDevices = allDevices.filter((device) => {
    const age = device.lastSeenAt !== null ? now - device.lastSeenAt : Number.POSITIVE_INFINITY;
    return age >= CLI_DAEMON_STALE_AFTER_MS;
  });

  if (commandArgs.includes('--stale')) {
    if (staleDevices.length === 0) {
      writeStdout('[agendex] no stale daemons to remove');
      return 0;
    }
    const staleIds = staleDevices.flatMap((device) =>
      device.deviceId === null ? [] : [device.deviceId],
    );
    if (staleIds.length === 0) {
      writeStdout('[agendex] stale daemons have no device IDs and cannot be removed');
      return 0;
    }
    const result = await deleteDaemons(staleIds);
    if (result.ok) {
      writeStdout(`[agendex] removed ${result.deleted} stale daemon(s)`);
    } else {
      writeStderr('[agendex] failed to remove stale daemons');
      return 1;
    }
    return 0;
  }

  // Interactive mode: use @clack/prompts multiselect (same pattern as configure)
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    writeStderr(
      '[agendex] interactive cleanup requires a TTY. Use --stale to auto-remove stale daemons.',
    );
    return 1;
  }

  const { promptForDaemonCleanup } = await import('./cleanup.ts');
  const deviceIds = allDevices.flatMap((device) => {
    if (device.deviceId === null) return [];
    const age = device.lastSeenAt !== null ? now - device.lastSeenAt : Number.POSITIVE_INFINITY;
    const status = age < CLI_DAEMON_STALE_AFTER_MS ? 'alive' : 'stale';
    return [
      {
        deviceId: device.deviceId,
        hostname: device.hostname ?? 'unknown',
        pid: device.pid,
        status: status as 'alive' | 'stale',
      },
    ];
  });

  if (deviceIds.length === 0) {
    writeStdout('[agendex] no daemons with device IDs to remove');
    return 0;
  }

  const selected = await promptForDaemonCleanup(deviceIds);
  if (!selected) return 0;

  const result = await deleteDaemons(selected);
  if (result.ok) {
    writeStdout(`[agendex] removed ${result.deleted} daemon(s)`);
  } else {
    writeStderr('[agendex] failed to remove daemons');
    return 1;
  }
  return 0;
}

/**
 * Notifies the running local server about a plan-source change so it scans +
 * (re)watches immediately. Returns an exit code (0 on success).
 */
async function notifyServerPlanSource(
  method: 'POST' | 'DELETE',
  resolved: string,
): Promise<number> {
  const cfg = loadConfig();
  const token = process.env.AGENDEX_TOKEN || cfg?.token;
  if (!token) {
    writeStderr('[agendex] no local token found in config — is the server running?');
    return 1;
  }
  const port = process.env.PORT ?? '4890';
  const { request } = await import('node:http');
  const body = JSON.stringify({ path: resolved });
  try {
    const res = await new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
      const req = request(
        `http://localhost:${port}/api/v1/plan-sources`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(body)),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: data }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (res.status >= 200 && res.status < 300) {
      const verb = method === 'POST' ? 'added' : 'removed';
      writeStdout(`[agendex] ${verb} custom plan dir: ${resolved}`);
      writeStdout(`[agendex] server notified — rescanning now`);
      return 0;
    }
    writeStderr(`[agendex] server returned ${res.status}: ${res.body}`);
    return 1;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    writeStderr(`[agendex] could not reach local server on port ${port}: ${msg}`);
    return 1;
  }
}

async function runAddDirCommand(commandArgs: string[]): Promise<number> {
  const dirPath = commandArgs.find(
    (arg) => arg !== 'add-dir' && arg !== '--dev' && !arg.startsWith('--'),
  );
  if (dirPath === undefined || dirPath.trim() === '') {
    writeStderr('[agendex] usage: agendex add-dir <path>');
    return 1;
  }
  const resolved = resolveCustomPlanDirPath(dirPath);
  if (!existsSync(resolved)) {
    writeStderr(`[agendex] path does not exist: ${resolved}`);
    return 1;
  }
  if (!statSync(resolved).isDirectory()) {
    writeStderr(`[agendex] path is not a directory: ${resolved}`);
    return 1;
  }

  if (commandArgs.includes('--live')) {
    // POST to the running local server so it scans + watches immediately
    return notifyServerPlanSource('POST', resolved);
  }

  updateConfig((config) => ({
    ...(config ?? { configVersion: CURRENT_CONFIG_VERSION, enabledAdapters: [] }),
    customPlanDirs: normalizeCustomPlanDirs([...(config?.customPlanDirs ?? []), resolved]),
  }));
  writeStdout(`[agendex] added custom plan dir: ${resolved}`);
  writeStdout(`[agendex] daemon will pick up the change automatically`);
  return 0;
}

async function runRemoveDirCommand(commandArgs: string[]): Promise<number> {
  const dirPath = commandArgs.find(
    (arg) => arg !== 'remove-dir' && arg !== '--dev' && !arg.startsWith('--'),
  );
  if (dirPath === undefined || dirPath.trim() === '') {
    writeStderr('[agendex] usage: agendex remove-dir <path> [--live]');
    return 1;
  }
  const resolved = resolveCustomPlanDirPath(dirPath);

  if (commandArgs.includes('--live')) {
    // DELETE on the running local server so it rescans + rewatches immediately
    return notifyServerPlanSource('DELETE', resolved);
  }

  let updated: string[] | null = null;
  updateConfig((config) => {
    updated = removeCustomPlanDir(config?.customPlanDirs ?? [], dirPath);
    if (updated === null) return null;
    return {
      ...(config ?? { configVersion: CURRENT_CONFIG_VERSION, enabledAdapters: [] }),
      customPlanDirs: updated,
    };
  });
  if (updated === null) {
    writeStderr(`[agendex] directory not in custom plan dirs: ${resolved}`);
    return 1;
  }
  writeStdout(`[agendex] removed custom plan dir: ${resolved}`);
  writeStdout(`[agendex] daemon will pick up the change automatically`);
  return 0;
}

const exitCode = await main().catch((err) => {
  writeStderr(`[agendex] ${err instanceof Error ? err.message : err}`);
  return 1;
});

await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);

if (exitCode !== 0) {
  process.exit(exitCode);
}

function flushStream(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.destroyed || !stream.writable) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    stream.write('', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
