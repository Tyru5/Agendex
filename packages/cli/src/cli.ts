#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadOrInitConfig } from '@agendex/shared';
import { CLI_DAEMON_STALE_AFTER_MS } from '@agendex/shared/daemon-status';
import { login, logout } from './auth.ts';
import { runWorker, startSupervisor } from './daemon.ts';
import { fetchDevices } from './api.ts';
import { isRunning, readPid, readPidInfo, removePid } from './pid.ts';
import { syncAll } from './sync.ts';
import { CLI_VERSION, checkForUpdate } from './version.ts';

const args = process.argv.slice(2);
const command = args[0] ?? 'start';
const cliEntry = resolve(process.argv[1] ?? fileURLToPath(import.meta.url));

async function main(): Promise<number> {
  const isInternal = args.includes('--daemon') || args.includes('--worker');
  if (command === '--version' || command === '-v') {
    writeStdout(CLI_VERSION);
    return 0;
  }

  const isPassthrough = ['stop', 'status', 'login', 'logout', 'help', '--help', '-h'].includes(
    command,
  );

  if (!isInternal && !isPassthrough) {
    const { updateAvailable, current, latest } = await checkForUpdate();
    if (updateAvailable) {
      writeStderr(`[agendex] update required: v${current} → v${latest}`);
      writeStderr(`[agendex] run: npm i -g agendex-cli`);
      return 1;
    }
  }

  switch (command) {
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

      const child = spawn(process.execPath, [cliEntry, 'start', '--daemon'], {
        detached: true,
        stdio: 'ignore',
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
      await syncAll();
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
            writeStdout(`[agendex] All daemons:`);
            for (const device of allDevices) {
              const age = device.lastSeenAt ? now - device.lastSeenAt : Number.POSITIVE_INFINITY;
              const status = age < CLI_DAEMON_STALE_AFTER_MS ? 'alive' : 'stale';
              const uptimeStr =
                device.startedAtMs != null ? formatDuration(now - device.startedAtMs) : '~';
              const pidStr = device.pid != null ? String(device.pid) : '~';
              const hostnameStr = device.hostname ?? '~';
              writeStdout(
                `- hostname: ${hostnameStr}\n  pid: ${pidStr}\n  uptime: ${uptimeStr}\n  status: ${status}`,
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
  agendex logout       Clear stored cloud token
  agendex configure    Select which agents/adapters to index
  agendex sync         One-shot scan + sync to cloud
  agendex status       Show current config state + daemon status
  agendex help         Show this help message
  agendex --version    Print CLI version
  agendex -v           Print CLI version
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
