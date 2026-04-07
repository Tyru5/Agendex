#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadOrInitConfig, setDevMode } from '@agendex/shared';
import { CLI_DAEMON_STALE_AFTER_MS } from '@agendex/shared/daemon-status';
import { deleteDaemons, fetchDevices, sendShutdown } from './api.ts';
import { login, logout } from './auth.ts';
import { runWorker, startSupervisor } from './daemon.ts';
import { isRunning, readPid, readPidInfo, removePid } from './pid.ts';
import { syncAll } from './sync.ts';
import { CLI_VERSION, checkForUpdate } from './version.ts';
import { openAgendexWeb } from './web.ts';

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
    'help',
    '--help',
    '-h',
  ].includes(command);

  if (!isInternal && !isPassthrough) {
    const { updateAvailable, current, latest } = await checkForUpdate();
    if (updateAvailable) {
      writeStderr(`[agendex] update required: v${current} → v${latest}`);
      writeStderr(`[agendex] run: npm i -g agendex-cli`);
      return 1;
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
      const { openSharedPlan } = await import('./web.ts');
      await openSharedPlan(url);
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
      const deadline = Date.now() + 5_000;
      while (isRunning(pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      if (isRunning(pid)) {
        writeStderr('[agendex] daemon did not stop in time');
      } else {
        removePid();
        await sendShutdown();
        writeStdout(`[agendex] daemon stopped (PID ${pid})`);
      }
      return isRunning(pid) ? 1 : 0;
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

    case 'cleanup': {
      const config = loadConfig();
      if (!config?.cloudToken || !config?.convexUrl) {
        writeStderr('[agendex] not logged in. Run `agendex login` first.');
        return 1;
      }

      const allDevices = await fetchDevices();
      if (allDevices.length === 0) {
        writeStdout('[agendex] no daemons found');
        return 0;
      }

      const now = Date.now();
      const staleDevices = allDevices.filter((d) => {
        const age = d.lastSeenAt ? now - d.lastSeenAt : Number.POSITIVE_INFINITY;
        return age >= CLI_DAEMON_STALE_AFTER_MS;
      });

      if (args.includes('--stale')) {
        if (staleDevices.length === 0) {
          writeStdout('[agendex] no stale daemons to remove');
          return 0;
        }
        const staleIds = staleDevices
          .map((d) => d.deviceId)
          .filter((id): id is string => id != null);
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
      const deviceIds = allDevices
        .filter((d) => d.deviceId != null)
        .map((d) => {
          const age = d.lastSeenAt ? now - d.lastSeenAt : Number.POSITIVE_INFINITY;
          const status = age < CLI_DAEMON_STALE_AFTER_MS ? 'alive' : 'stale';
          return {
            deviceId: d.deviceId as string,
            hostname: d.hostname ?? 'unknown',
            pid: d.pid,
            status: status as 'alive' | 'stale',
          };
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

    case 'status': {
      const config = loadConfig();
      const pidInfo = readPidInfo();

      const pid = pidInfo?.pid ?? null;

      const running = pid ? isRunning(pid) : false;

      writeStdout(`[agendex] Config version: ${config?.configVersion ?? 'none'}`);
      writeStdout(`[agendex] Local token: ${config?.token ? 'set' : 'not set'}`);
      writeStdout(`[agendex] Cloud token: ${config?.cloudToken ? 'set' : 'not set'}`);
      writeStdout(`[agendex] Convex URL: ${config?.convexUrl ?? 'not set'}`);
      writeStdout(`[agendex] Enabled adapters: ${config?.enabledAdapters.join(', ') || 'none'}`);
      writeStdout(`[agendex] Daemon: ${running ? `running (PID ${pid})` : 'not running'}`);

      if (running && pidInfo?.startedAtMs) {
        writeStdout(`[agendex] Uptime: ${formatDuration(Date.now() - pidInfo.startedAtMs)}`);
      } else if (running) {
        writeStdout(`[agendex] Uptime: unknown (restart daemon to populate)`);
      } else {
        writeStdout(`[agendex] Uptime: n/a`);
      }

      if (running && pidInfo?.hostname) {
        writeStdout(`[agendex] Hostname: ${pidInfo.hostname}`);
      } else if (running) {
        writeStdout(`[agendex] Hostname: unknown (restart daemon to populate)`);
      } else {
        writeStdout(`[agendex] Hostname: n/a`);
      }

      writeStdout(`[agendex] CLI version: ${CLI_VERSION}`);

      // Fetch all daemons from the cloud
      try {
        if (config?.cloudToken && config?.convexUrl) {
          const allDevices = await fetchDevices();
          if (allDevices.length > 0) {
            const now = Date.now();
            const localDeviceId = config.deviceId;
            writeStdout(`[agendex] All daemons:`);
            for (const device of allDevices) {
              const age = device.lastSeenAt ? now - device.lastSeenAt : Number.POSITIVE_INFINITY;
              const status = age < CLI_DAEMON_STALE_AFTER_MS ? 'alive' : 'stale';
              const uptimeStr =
                device.startedAtMs != null ? formatDuration(now - device.startedAtMs) : '~';
              const pidStr = device.pid != null ? String(device.pid) : '~';
              const hostnameStr = device.hostname ?? '~';
              const isLocal = localDeviceId && device.deviceId === localDeviceId;
              writeStdout(
                `- hostname: ${hostnameStr}${isLocal ? ' (this machine)' : ''}\n  pid: ${pidStr}\n  uptime: ${uptimeStr}\n  status: ${status}`,
              );
            }
          } else {
            writeStdout(`[agendex] All daemons: none`);
          }
        }
      } catch {
        // Best-effort: skip daemon list if not logged in or network error
      }

      return 0;
    }

    case 'help':
    case '--help':
    case '-h': {
      writeStdout(
        `
agendex - CLI for syncing local agent plans to the cloud

Usage:
  agendex              Start daemon (default, backgrounds itself)
  agendex start        Start daemon (backgrounds itself)
  agendex stop         Stop the running daemon
  agendex login        Authenticate via browser OAuth (agendex.dev)
  agendex login --url <url>  Login to a self-hosted instance
  agendex open         Open the Agendex web app in your browser
  agendex open --url <url>  Open a self-hosted instance
  agendex view <url>   Open a shared plan URL in your browser
  agendex logout       Clear stored cloud token
  agendex configure    Select which agents/adapters to index
  agendex sync         One-shot scan + sync to cloud (skips unchanged plans)
  agendex sync --force Re-sync all plans, ignoring cache
  agendex cleanup      Interactively remove cloud daemons
  agendex cleanup --stale  Auto-remove all stale daemons
  agendex status       Show current config state + daemon status
  agendex help         Show this help message
  agendex --version    Print CLI version
  agendex -v           Print CLI version

Flags:
  --dev                Use dev environment (~/.agendex-dev/ config dir)
`.trim(),
      );
      return 0;
    }

    default: {
      writeStderr(`Unknown command: ${command}`);
      writeStderr(`Run "agendex help" for usage.`);
      return 1;
    }
  }
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

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
