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

/** Current on-disk config schema version. Bump when applying one-shot migrations. */
export const CURRENT_CONFIG_VERSION = 4;

/**
 * One-shot adapter enable migrations.
 * When upgrading past `toVersion`, missing adapters in `enable` are appended to
 * the user's stored list. After the user saves at that version (or higher), the
 * migration does not re-add adapters they later disable via configure.
 */
const ADAPTER_ENABLE_MIGRATIONS: Array<{ toVersion: number; enable: AdapterId[] }> = [
  // v4: Grok adapter shipped default-enabled; existing installs had a frozen
  // enabledAdapters list from before the catalog entry existed.
  { toVersion: 4, enable: ['grok'] },
];

export interface AgendexConfig {
  configVersion: number;
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

function normalizeConfigVersion(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    return Math.floor(input);
  }
  return 0;
}

/**
 * Apply versioned adapter-enable migrations for upgrades.
 * Callers that write config should persist CURRENT_CONFIG_VERSION so each
 * migration runs at most once per install.
 *
 * Empty adapter lists are left alone: callers treat `[]` as "no frozen
 * selection yet" and fall back to catalog defaults. Only append newly
 * default-enabled adapters when the user already has a non-empty list
 * (i.e. a frozen selection from a prior install).
 */
export function applyAdapterEnableMigrations(
  fromVersion: number,
  adapters: AdapterId[],
): { version: number; adapters: AdapterId[] } {
  let version = fromVersion > 0 ? fromVersion : 0;
  const next = [...adapters];
  // Empty means "no frozen selection" — do not invent a one-adapter list
  // (e.g. login writes [] with an older configVersion; that must stay empty
  // so loadOrInitConfig can still auto-enable catalog defaults).
  const hasFrozenList = next.length > 0;

  for (const migration of ADAPTER_ENABLE_MIGRATIONS) {
    if (version >= migration.toVersion) continue;
    if (hasFrozenList) {
      for (const id of migration.enable) {
        if (!next.includes(id)) next.push(id);
      }
    }
    version = migration.toVersion;
  }

  if (version < CURRENT_CONFIG_VERSION) version = CURRENT_CONFIG_VERSION;

  return {
    version,
    adapters: sanitizeEnabledAdapterIds(next),
  };
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
  const canonicalTarget = canonicalizeCustomPlanDir(resolved);
  const updated = dirs.filter((d) => {
    const normalized = resolveCustomPlanDirPath(d);
    return normalized !== resolved && canonicalizeCustomPlanDir(normalized) !== canonicalTarget;
  });
  if (updated.length !== dirs.length) return updated;

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

  const rawVersion = normalizeConfigVersion(raw.configVersion);
  const migrated = applyAdapterEnableMigrations(
    rawVersion,
    normalizeAdapterIds(raw.enabledAdapters),
  );

  return {
    configVersion: migrated.version,
    token,
    cloudToken,
    convexUrl,
    siteUrl,
    deviceId,
    collectLocalIpAddress,
    enabledAdapters: migrated.adapters,
    customPlanDirs: normalizeCustomPlanDirs(raw.customPlanDirs),
  };
}

export function loadConfig(): AgendexConfig | null {
  return normalizeStoredConfig(readStoredConfig());
}

export function saveConfig(config: AgendexConfig) {
  ensureConfigDir();
  const fromVersion = normalizeConfigVersion(config.configVersion);
  // If the caller is still on an older schema version, apply enable migrations
  // before bumping to CURRENT. Callers that already pass CURRENT (e.g. after a
  // deliberate configure that dropped an auto-enabled adapter) are left alone.
  const migrated =
    fromVersion < CURRENT_CONFIG_VERSION
      ? applyAdapterEnableMigrations(fromVersion, sanitizeEnabledAdapterIds(config.enabledAdapters))
      : {
          version: CURRENT_CONFIG_VERSION,
          adapters: sanitizeEnabledAdapterIds(config.enabledAdapters),
        };

  const payload: AgendexConfig = {
    configVersion: migrated.version,
    token: config.token,
    cloudToken: config.cloudToken,
    convexUrl: config.convexUrl,
    siteUrl: config.siteUrl,
    deviceId: config.deviceId,
    collectLocalIpAddress: config.collectLocalIpAddress,
    enabledAdapters: migrated.adapters,
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
    ...existing,
    configVersion: CURRENT_CONFIG_VERSION,
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
    ...existing,
    configVersion: CURRENT_CONFIG_VERSION,
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
    configVersion: CURRENT_CONFIG_VERSION,
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
