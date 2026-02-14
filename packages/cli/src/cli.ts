#!/usr/bin/env bun

import { loadConfig } from '@agendex/shared';

const args = process.argv.slice(2);
const command = args[0] ?? 'start';

async function main() {
  switch (command) {
    case 'start': {
      const { startDaemon } = await import('./daemon.ts');
      await startDaemon();
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
      console.log(`[agendex] Config version: ${config?.configVersion ?? 'none'}`);
      console.log(`[agendex] Local token: ${config?.token ? 'set' : 'not set'}`);
      console.log(`[agendex] Cloud token: ${config?.cloudToken ? 'set' : 'not set'}`);
      console.log(`[agendex] Convex URL: ${config?.convexUrl ?? 'not set'}`);
      console.log(`[agendex] Enabled adapters: ${config?.enabledAdapters.join(', ') || 'none'}`);
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      console.log(
        `
agendex - CLI for syncing local agent plans to the cloud

Usage:
  agendex              Start daemon (default)
  agendex start        Start daemon (watches + syncs)
  agendex login        Authenticate via browser OAuth (agendex.dev)
  agendex login --url <url>  Login to a self-hosted instance
  agendex logout       Clear stored cloud token
  agendex sync         One-shot scan + sync to cloud
  agendex status       Show current config state
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
