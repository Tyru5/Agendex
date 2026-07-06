import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AdapterId } from './adapters/catalog.ts';
import { getDefaultAdapterIds, sanitizeEnabledAdapterIds } from './adapters/registry.ts';
import { canPromptForAdapters, promptForAdapterSelection } from './setup/adapter-selection.ts';

let devModeOverride: boolean | undefined;

export function getHomeDir(): string {
  if (process.env.HOME) return process.env.HOME;
  if (process.env.USERPROFILE) return process.env.USERPROFILE;
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`;
  }
  return homedir();
}

export function setDevMode(dev: boolean): void {
  devModeOverride = dev;
}

export function isDevMode(): boolean {
  if (devModeOverride !== undefined) return devModeOverride;
  return process.env.AGENDEX_DEV === '1';
}

export function getConfigDir(): string {
  const override = process.env.AGENDEX_CONFIG_DIR?.trim();
  if (override) return resolve(expandHomePath(override));

  return join(getHomeDir(), isDevMode() ? '.agendex-dev' : '.agendex');
}

export interface AgendexConfig {
  configVersion: 3;
  token?: string;
  cloudToken?: string;
  convexUrl?: string;
  /** Web app base URL used at login (for self-hosted / custom deployments). */
  siteUrl?: string;
  deviceId?: string;
  collectLocalIpAddress?: boolean;
  enabledAdapters: AdapterId[];
  customPlanDirs: string[];
}

interface StoredConfig {
  configVersion?: number;
  token?: unknown;
  cloudToken?: unknown;
  convexUrl?: unknown;
  siteUrl?: unknown;
  deviceId?: unknown;
  collectLocalIpAddress?: unknown;
  enabledAdapters?: unknown;
  customPlanDirs?: unknown;
}

function ensureConfigDir() {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readStoredConfig(): StoredConfig | null {
  const cfgPath = getConfigPath();
  if (!existsSync(cfgPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8')) as StoredConfig;
    if (!raw || typeof raw !== 'object') return null;

    return raw;
  } catch {
    return null;
  }
}

function normalizeAdapterIds(input: unknown): AdapterId[] {
  if (!Array.isArray(input)) return [];
  return sanitizeEnabledAdapterIds(
    input.filter((item): item is string => typeof item === 'string'),
  );
}

function expandHomePath(p: string): string {
  if (p.startsWith('~/') || p === '~') return join(getHomeDir(), p.slice(1));
  return p;
}

/** Resolves a user-supplied plan directory path (expands `~`, then `path.resolve`). */
export function resolveCustomPlanDirPath(userPath: string): string {
  const trimmed = userPath.trim();
  if (!trimmed) {
    throw new Error('Custom plan directory path must not be empty');
  }
  return resolve(expandHomePath(trimmed));
}

/** Resolves a path and, when it exists, its real (symlink-resolved) location. */
function canonicalizeCustomPlanDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Removes the custom plan dir matching `target` from `dirs`. Matches by exact
 * normalized path first, then falls back to symlink-resolved (realpath) equality
 * so a dir can be removed even if supplied via a symlink or different-cwd relative
 * path. Returns the updated list, or `null` if nothing matched.
 */
export function removeCustomPlanDir(dirs: string[], target: string): string[] | null {
  const resolved = resolveCustomPlanDirPath(target);
  const exact = dirs.filter((d) => d !== resolved);
  if (exact.length !== dirs.length) return exact;

  const canonicalTarget = canonicalizeCustomPlanDir(resolved);
  const byRealpath = dirs.filter(
    (d) => canonicalizeCustomPlanDir(resolveCustomPlanDirPath(d)) !== canonicalTarget,
  );
  if (byRealpath.length !== dirs.length) return byRealpath;

  return null;
}

export function normalizeCustomPlanDirs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const normalized = resolveCustomPlanDirPath(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeStoredConfig(raw: StoredConfig | null): AgendexConfig | null {
  if (!raw) return null;

  const token = typeof raw.token === 'string' && raw.token.trim() ? raw.token : undefined;
  const cloudToken =
    typeof raw.cloudToken === 'string' && raw.cloudToken.trim() ? raw.cloudToken : undefined;
  const convexUrl =
    typeof raw.convexUrl === 'string' && raw.convexUrl.trim() ? raw.convexUrl : undefined;
  const siteUrl = typeof raw.siteUrl === 'string' && raw.siteUrl.trim() ? raw.siteUrl : undefined;
  const deviceId =
    typeof raw.deviceId === 'string' && raw.deviceId.trim() ? raw.deviceId : undefined;
  const collectLocalIpAddress =
    typeof raw.collectLocalIpAddress === 'boolean' ? raw.collectLocalIpAddress : undefined;

  return {
    configVersion: 3, //TODO: implement actual logic here for incrementing the configVersion
    token,
    cloudToken,
    convexUrl,
    siteUrl,
    deviceId,
    collectLocalIpAddress,
    enabledAdapters: normalizeAdapterIds(raw.enabledAdapters),
    customPlanDirs: normalizeCustomPlanDirs(raw.customPlanDirs),
  };
}

export function loadConfig(): AgendexConfig | null {
  return normalizeStoredConfig(readStoredConfig());
}

export function saveConfig(config: AgendexConfig) {
  ensureConfigDir();
  const payload: AgendexConfig = {
    configVersion: 3,
    token: config.token,
    cloudToken: config.cloudToken,
    convexUrl: config.convexUrl,
    siteUrl: config.siteUrl,
    deviceId: config.deviceId,
    collectLocalIpAddress: config.collectLocalIpAddress,
    enabledAdapters: sanitizeEnabledAdapterIds(config.enabledAdapters),
    customPlanDirs: normalizeCustomPlanDirs(config.customPlanDirs),
  };
  writeFileSync(getConfigPath(), JSON.stringify(payload, null, 2));
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function loadOrCreateToken(): string {
  if (process.env.AGENDEX_TOKEN) return process.env.AGENDEX_TOKEN;

  const existing = loadConfig();
  if (existing?.token) return existing.token;

  const token = generateToken();
  saveConfig({
    ...(existing ?? {}),
    configVersion: 3,
    token,
    enabledAdapters: existing?.enabledAdapters ?? [],
    customPlanDirs: existing?.customPlanDirs ?? [],
  });
  console.log(`\n[agendex] generated auth token: ${token}`);
  console.log(`[agendex] saved to ${getConfigPath()}\n`);
  return token;
}

export function loadOrCreateDeviceId(): string {
  const existing = loadConfig();
  if (existing?.deviceId) return existing.deviceId;

  const deviceId = randomBytes(16).toString('hex');
  saveConfig({
    ...(existing ?? {}),
    configVersion: 3,
    deviceId,
    enabledAdapters: existing?.enabledAdapters ?? [],
    customPlanDirs: existing?.customPlanDirs ?? [],
  });
  return deviceId;
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export interface InitConfigOptions {
  configureAdapters?: boolean;
}

export async function loadOrInitConfig(options: InitConfigOptions = {}): Promise<AgendexConfig> {
  const configureAdapters = Boolean(options.configureAdapters);
  const existing = loadConfig();
  const tokenFromEnv = process.env.AGENDEX_TOKEN;
  const currentToken = tokenFromEnv || existing?.token || loadOrCreateToken();

  const storedAdapterIds = existing?.enabledAdapters ?? [];
  const needsSelection = configureAdapters || storedAdapterIds.length === 0;

  let enabledAdapters = storedAdapterIds;
  if (needsSelection) {
    if (canPromptForAdapters()) {
      enabledAdapters = await promptForAdapterSelection({
        currentIds: storedAdapterIds,
        configureAdapters,
      });
    } else if (configureAdapters) {
      throw new Error(
        'Cannot run --configure-adapters without an interactive TTY. Run this command in a terminal.',
      );
    } else {
      enabledAdapters = getDefaultAdapterIds();
      console.log(
        `[agendex] non-interactive environment detected; auto-enabling defaults: ${enabledAdapters.join(', ')}`,
      );
    }
  } else {
    enabledAdapters = sanitizeEnabledAdapterIds(storedAdapterIds);
    if (enabledAdapters.length === 0) enabledAdapters = getDefaultAdapterIds();
  }

  const deviceId = existing?.deviceId || randomBytes(16).toString('hex');

  const nextConfig: AgendexConfig = {
    configVersion: 3,
    token: tokenFromEnv ? existing?.token : currentToken,
    cloudToken: existing?.cloudToken,
    convexUrl: existing?.convexUrl,
    siteUrl: existing?.siteUrl,
    deviceId,
    enabledAdapters,
    customPlanDirs: existing?.customPlanDirs ?? [],
  };
  saveConfig(nextConfig);

  return {
    ...nextConfig,
    token: currentToken,
  };
}
