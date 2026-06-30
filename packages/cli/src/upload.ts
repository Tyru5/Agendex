import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { loadConfig, loadOrCreateDeviceId, resolveCustomPlanDirPath } from '@agendex/shared';
import { getSiteUrl, launchBrowser } from './auth.ts';
import { type SyncPlanResult, syncPlan as defaultSyncPlan } from './api.ts';
import { getLocalIpAddress } from './network.ts';
import { fileToSyncPayload } from './payload.ts';
import { shouldIncludeLocalIpAddressInSync } from './sync-privacy.ts';

export interface UploadDeps {
  syncPlan: (plan: ReturnType<typeof fileToSyncPayload>) => Promise<SyncPlanResult>;
  log: (message: string) => void;
  error: (message: string) => void;
  openBrowser: (url: string, label: string) => void;
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/** Resolve the first non-flag positional argument after the `upload` command. */
function resolvePathArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === 'upload' || a === '--dev' || a === '--open') continue;
    if (a === '--agent') {
      i++; // skip the agent value
      continue;
    }
    if (a.startsWith('--')) continue;
    return a;
  }
  return undefined;
}

export async function runUpload(args: string[], deps?: Partial<UploadDeps>): Promise<number> {
  const syncPlanFn = deps?.syncPlan ?? defaultSyncPlan;
  const log = deps?.log ?? ((m: string) => console.log(m));
  const error = deps?.error ?? ((m: string) => console.error(m));
  const openBrowser = deps?.openBrowser ?? launchBrowser;

  const pathArg = resolvePathArg(args);
  if (!pathArg || !pathArg.trim()) {
    error('[agendex] usage: agendex upload <path> [--agent <name>] [--open]');
    return 1;
  }

  const absolutePath = resolveCustomPlanDirPath(pathArg);

  if (!existsSync(absolutePath)) {
    error(`[agendex] path does not exist: ${absolutePath}`);
    return 1;
  }

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(absolutePath);
  } catch (err) {
    error(`[agendex] could not read path: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (stats.isDirectory()) {
    error(`[agendex] path is a directory, expected a single file: ${absolutePath}`);
    return 1;
  }

  if (!/\.md$/i.test(absolutePath)) {
    error(`[agendex] only Markdown (.md) files are supported: ${absolutePath}`);
    return 1;
  }

  const config = loadConfig();
  if (!config?.cloudToken || !config?.convexUrl) {
    error('[agendex] not logged in. Run `agendex login` first.');
    return 1;
  }

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch (err) {
    error(`[agendex] could not read file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const agentOverride = flagValue(args, '--agent');
  const ipAddress = (await shouldIncludeLocalIpAddressInSync()) ? getLocalIpAddress() : undefined;

  const payload = fileToSyncPayload(absolutePath, content, {
    agentOverride,
    deviceId: config.deviceId ?? loadOrCreateDeviceId(),
    hostname: osHostname(),
    ipAddress,
    createdAt: stats.birthtime.getTime(),
    updatedAt: stats.mtime.getTime(),
  });

  const result = await syncPlanFn(payload);

  if (!result.ok) {
    if (result.status === 403) {
      error(`[agendex] ${result.error ?? 'Cloud Pro subscription required'}`);
      error(`[agendex] View plans and pricing: ${getSiteUrl().replace(/\/$/, '')}/#pricing`);
      return 1;
    }
    error(`[agendex] upload failed: ${result.error ?? 'unknown error'}`);
    return 1;
  }

  if (result.skippedLowValue) {
    log(
      `[agendex] "${payload.title}" was skipped as a low-value plan and was not stored in the cloud.`,
    );
    return 0;
  }

  const site = getSiteUrl().replace(/\/$/, '');
  const planUrl = result.planId
    ? `${site}/dashboard?plan=${encodeURIComponent(result.planId)}`
    : `${site}/dashboard`;

  log(`[agendex] uploaded "${payload.title}"`);
  log(`[agendex] ${planUrl}`);

  if (args.includes('--open')) {
    openBrowser(planUrl, 'uploaded plan in your browser');
  }

  return 0;
}
