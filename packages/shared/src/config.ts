import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AdapterId } from './adapters/catalog.ts';
import { getDefaultAdapterIds, sanitizeEnabledAdapterIds } from './adapters/registry.ts';
import { canPromptForAdapters, promptForAdapterSelection } from './setup/adapter-selection.ts';

const configDir = join(homedir(), '.agendex');
const configPath = join(configDir, 'config.json');

export interface AgendexConfig {
  configVersion: 3;
  token?: string;
  cloudToken?: string;
  convexUrl?: string;
  deviceId?: string;
  enabledAdapters: AdapterId[];
}

interface StoredConfig {
  configVersion?: number;
  token?: unknown;
  cloudToken?: unknown;
  convexUrl?: unknown;
  deviceId?: unknown;
  enabledAdapters?: unknown;
}

function ensureConfigDir() {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

function readStoredConfig(): StoredConfig | null {
  if (!existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as StoredConfig;
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
    configVersion: 3,
    token,
    cloudToken,
    convexUrl,
    deviceId,
    enabledAdapters: normalizeAdapterIds(raw.enabledAdapters),
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
  };
  writeFileSync(configPath, JSON.stringify(payload, null, 2));
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
  });
  console.log(`\n[agendex] generated auth token: ${token}`);
  console.log(`[agendex] saved to ${configPath}\n`);
  return token;
}

export function loadOrCreateDeviceId(): string {
  const existing = loadConfig();
  if (existing?.deviceId) return existing.deviceId;

  const deviceId = randomBytes(16).toString('hex');
  saveConfig({
    configVersion: 3,
    deviceId,
    enabledAdapters: existing?.enabledAdapters ?? [],
    token: existing?.token,
    cloudToken: existing?.cloudToken,
    convexUrl: existing?.convexUrl,
  });
  return deviceId;
}

export function getConfigPath(): string {
  return configPath;
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
  };
  saveConfig(nextConfig);

  return {
    ...nextConfig,
    token: currentToken,
  };
}
