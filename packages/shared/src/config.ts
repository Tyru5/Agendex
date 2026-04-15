import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AdapterId } from './adapters/catalog.ts';
import { getDefaultAdapterIds, sanitizeEnabledAdapterIds } from './adapters/registry.ts';
import { canPromptForAdapters, promptForAdapterSelection } from './setup/adapter-selection.ts';

let devModeOverride: boolean | undefined;

export function setDevMode(dev: boolean): void {
  devModeOverride = dev;
}

export function isDevMode(): boolean {
  if (devModeOverride !== undefined) return devModeOverride;
  return process.env.AGENDEX_DEV === '1';
}

export function getConfigDir(): string {
  return join(homedir(), isDevMode() ? '.agendex-dev' : '.agendex');
}

export interface AgendexConfig {
  configVersion: 3;
  token?: string;
  cloudToken?: string;
  convexUrl?: string;
  deviceId?: string;
  enabledAdapters: AdapterId[];
  customPlanDirs: string[];
}

interface StoredConfig {
  configVersion?: number;
  token?: unknown;
  cloudToken?: unknown;
  convexUrl?: unknown;
  deviceId?: unknown;
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
  if (p.startsWith('~/') || p === '~') return join(homedir(), p.slice(1));
  return p;
}

export function normalizeCustomPlanDirs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const normalized = resolve(expandHomePath(trimmed));
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
  const deviceId =
    typeof raw.deviceId === 'string' && raw.deviceId.trim() ? raw.deviceId : undefined;

  return {
    configVersion: 3, //TODO: implement actual logic here for incrementing the configVersion
    token,
    cloudToken,
    convexUrl,
    deviceId,
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
    deviceId: config.deviceId,
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
