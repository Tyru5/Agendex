#!/usr/bin/env bun

import { loadConfig } from '@agendex/shared';
import { isRunning, readPid, removePid } from './pid.ts';

const args = process.argv.slice(2);
const command = args[0] ?? 'start';

async function main() {
  switch (command) {
    case 'start': {
      if (args.includes('--daemon')) {
        const { startSupervisor } = await import('./daemon.ts');
        await startSupervisor();
        break;
      }

      if (args.includes('--worker')) {
        const { runWorker } = await import('./daemon.ts');
        await runWorker();
        break;
      }

      const existingPid = readPid();
      if (existingPid && isRunning(existingPid)) {
        console.log(`[agendex] daemon already running (PID ${existingPid})`);
        break;
      }

      if (existingPid) removePid();

      const scriptPath = new URL(import.meta.url).pathname;
      const child = Bun.spawn(['bun', scriptPath, 'start', '--daemon'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      child.unref();

      // brief wait to let child write PID
      await new Promise((r) => setTimeout(r, 500));
      const pid = readPid();
      console.log(`[agendex] daemon started${pid ? ` (PID ${pid})` : ''}`);
      break;
    }

    case 'stop': {
      const pid = readPid();
      if (!pid || !isRunning(pid)) {
        removePid();
        console.log('[agendex] daemon is not running');
        break;
      }

      process.kill(pid, 'SIGTERM');
      const deadline = Date.now() + 5_000;
      while (isRunning(pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      if (isRunning(pid)) {
        console.error('[agendex] daemon did not stop in time');
      } else {
        removePid();
        console.log(`[agendex] daemon stopped (PID ${pid})`);
      }
      break;
    }

    case 'login': {
      const { login } = await import('./auth.ts');
      const urlIdx = args.indexOf('--url');
      const siteUrl = urlIdx !== -1 ? args[urlIdx + 1] : undefined;
      await login(siteUrl);
      break;
    }

    case 'logout': {
      const { logout } = await import('./auth.ts');
      logout();
      break;
    }

    case 'sync': {
      const { syncAll } = await import('./sync.ts');
      await syncAll();
      break;
    }

    case 'status': {
      const config = loadConfig();
      const pid = readPid();
      const running = pid ? isRunning(pid) : false;
      console.log(`[agendex] Config version: ${config?.configVersion ?? 'none'}`);
      console.log(`[agendex] Local token: ${config?.token ? 'set' : 'not set'}`);
      console.log(`[agendex] Cloud token: ${config?.cloudToken ? 'set' : 'not set'}`);
      console.log(`[agendex] Convex URL: ${config?.convexUrl ?? 'not set'}`);
      console.log(`[agendex] Enabled adapters: ${config?.enabledAdapters.join(', ') || 'none'}`);
      console.log(`[agendex] Daemon: ${running ? `running (PID ${pid})` : 'not running'}`);
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      console.log(
        `
agendex - CLI for syncing local agent plans to the cloud

Usage:
  agendex              Start daemon (default, backgrounds itself)
  agendex start        Start daemon (backgrounds itself)
  agendex stop         Stop the running daemon
  agendex login        Authenticate via browser OAuth (agendex.dev)
  agendex login --url <url>  Login to a self-hosted instance
  agendex logout       Clear stored cloud token
  agendex sync         One-shot scan + sync to cloud
  agendex status       Show current config state + daemon status
  agendex help         Show this help message
`.trim(),
      );
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error(`Run "agendex help" for usage.`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('[agendex]', err instanceof Error ? err.message : err);
  process.exit(1);
});
