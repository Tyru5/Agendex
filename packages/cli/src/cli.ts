#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, statSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getConfigPath,
  loadConfig,
  loadOrInitConfig,
  normalizeCustomPlanDirs,
  removeCustomPlanDir,
  resolveCustomPlanDirPath,
  saveConfig,
  setDevMode,
} from '@agendex/shared';
import { CLI_DAEMON_STALE_AFTER_MS } from '@agendex/shared/daemon-status';
import type { DeviceInfo } from './api.ts';
import { AuthExpiredError, deleteDaemons, fetchDevices, sendShutdown } from './api.ts';
import { login, logout } from './auth.ts';
import { renderHelp } from './help.ts';
import { runWorker, startSupervisor } from './daemon.ts';
import { runHookReviewCommand, runHooksCommand } from './hooks.ts';
import { isRunning, readPid, readPidInfo, removePid } from './pid.ts';
import { renderStatus, type CloudDaemonStatusError } from './status.ts';
import { syncAll } from './sync.ts';
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

async function main(): Promise<number> {
  const isInternal = args.includes('--daemon') || args.includes('--worker');
  if (command === '--version' || command === '-v') {
    writeStdout(CLI_VERSION);
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
    'add-dir',
    'remove-dir',
    'list-dirs',
    'upload',
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
        await runWorker();
        return 0;
      }

      const existingPid = readPid();
      if (existingPid && isRunning(existingPid)) {
        writeStdout(`[agendex] daemon already running (PID ${existingPid})`);
        return 0;
      }

      if (existingPid) removePid();

      const daemonArgs = [cliEntry, 'start', '--daemon'];
      if (devFlag) daemonArgs.push('--dev');

      const child = spawn(process.execPath, daemonArgs, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...(devFlag ? { AGENDEX_DEV: '1' } : {}) },
      });
      child.unref();

      // brief wait to let child write PID
      await new Promise((r) => setTimeout(r, 500));
      const pid = readPid();
      writeStdout(`[agendex] daemon started${pid ? ` (PID ${pid})` : ''}`);
      return 0;
    }

    case 'stop': {
      const pid = readPid();
      if (!pid || !isRunning(pid)) {
        removePid();
        writeStdout('[agendex] daemon is not running');
        return 0;
      }

      process.kill(pid, 'SIGTERM');
      const stopped = await waitForProcessExit(pid, 5_000);

      if (!stopped) {
        writeStderr('[agendex] daemon did not stop in time');
        return 1;
      }

      removePid();
      await sendShutdown();
      writeStdout(`[agendex] daemon stopped (PID ${pid})`);
      return 0;
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

    case 'hooks': {
      return runHooksCommand(args, cliEntry);
    }

    case 'review-plan': {
      return runHookReviewCommand(args);
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
      const pid = pidInfo?.pid ?? null;
      const running = pid ? isRunning(pid) : false;
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

    case 'help':
    case '--help':
    case '-h': {
      writeStdout(renderHelp({ cliVersion: CLI_VERSION }));
      return 0;
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
  const token = cfg?.token;
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

  const cfg = loadConfig();
  const currentDirs = cfg?.customPlanDirs ?? [];
  const updated = normalizeCustomPlanDirs([...currentDirs, resolved]);
  saveConfig({
    ...(cfg ?? { configVersion: 3, enabledAdapters: [] }),
    customPlanDirs: updated,
  });
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

  const cfg = loadConfig();
  const currentDirs = cfg?.customPlanDirs ?? [];
  const updated = removeCustomPlanDir(currentDirs, dirPath);
  if (updated === null) {
    writeStderr(`[agendex] directory not in custom plan dirs: ${resolved}`);
    return 1;
  }
  saveConfig({
    ...(cfg ?? { configVersion: 3, enabledAdapters: [] }),
    customPlanDirs: updated,
  });
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

function writeStdout(message: string): void {
  writeSync(process.stdout.fd, `${message}\n`);
}

function writeStderr(message: string): void {
  writeSync(process.stderr.fd, `${message}\n`);
}
