import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAdapterEnableMigrations,
  CURRENT_CONFIG_VERSION,
  getConfigPath,
  getHomeDir,
  isHomeRelativePath,
  loadConfig,
  loadOrCreateToken,
  loadOrInitConfig,
  removeCustomPlanDir,
  resolveCustomPlanDirPath,
  saveConfig,
  updateConfig,
} from './config.ts';

const originalEnv: Record<string, string | undefined> = {
  AGENDEX_CONFIG_DIR: process.env.AGENDEX_CONFIG_DIR,
  AGENDEX_DEV: process.env.AGENDEX_DEV,
  AGENDEX_HOME: process.env.AGENDEX_HOME,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
};

let tempRoot: string | undefined;

/** Order-insensitive subset check (the local `bun:test` typings omit `expect.arrayContaining`). */
function expectToContainAll(actual: readonly unknown[] | undefined, expected: readonly unknown[]) {
  expect(Array.isArray(actual)).toBe(true);
  for (const item of expected) expect(actual).toContain(item);
}

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function useTempConfigDir() {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-config-'));
  const configDir = join(tempRoot, '.agendex-test');
  process.env.AGENDEX_CONFIG_DIR = configDir;
  delete process.env.AGENDEX_DEV;
  return configDir;
}

afterEach(async () => {
  restoreEnv('AGENDEX_CONFIG_DIR');
  restoreEnv('AGENDEX_DEV');
  restoreEnv('AGENDEX_HOME');
  restoreEnv('HOME');
  restoreEnv('USERPROFILE');

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

test('AGENDEX_CONFIG_DIR overrides the user config path for tests and tooling', async () => {
  const configDir = await useTempConfigDir();

  expect(getConfigPath()).toBe(join(configDir, 'config.json'));
});

test('AGENDEX_HOME overrides HOME and USERPROFILE for agent root resolution', () => {
  process.env.HOME = 'C:\\Users\\native';
  process.env.USERPROFILE = 'C:\\Users\\native';
  process.env.AGENDEX_HOME = '\\\\wsl$\\Ubuntu\\home\\ty';

  expect(getHomeDir()).toBe('\\\\wsl$\\Ubuntu\\home\\ty');

  process.env.AGENDEX_HOME = '   ';
  expect(getHomeDir()).toBe('C:\\Users\\native');
});

test('loadOrCreateToken preserves existing cloud session fields', async () => {
  await useTempConfigDir();
  const customPlanDir = join(tmpdir(), 'agendex-plans');

  saveConfig({
    configVersion: 3,
    cloudToken: 'cloud-session',
    cloudAccountId: 'account-1',
    convexUrl: 'http://127.0.0.1:3210',
    deviceId: 'device-1',
    enabledAdapters: ['cursor'],
    customPlanDirs: [customPlanDir],
  });

  const token = loadOrCreateToken();
  const config = loadConfig();

  expect(token).toHaveLength(64);
  expect(config).toMatchObject({
    token,
    cloudToken: 'cloud-session',
    cloudAccountId: 'account-1',
    convexUrl: 'http://127.0.0.1:3210',
    deviceId: 'device-1',
    customPlanDirs: [customPlanDir],
  });
  // v3→v4 migration auto-enables grok for pre-existing installs.
  expectToContainAll(config?.enabledAdapters, [
    'cursor',
    'grok',
    'antigravity',
    'gemini-cli',
    'kiro-cli',
  ]);
  expect(config?.configVersion).toBe(CURRENT_CONFIG_VERSION);
});

test('concurrent config updates preserve both process changes', async () => {
  const configDir = await useTempConfigDir();
  const contender = fileURLToPath(
    new URL('../scripts/config-update-contender.ts', import.meta.url),
  );
  const env = { ...process.env, AGENDEX_CONFIG_DIR: configDir };
  const device = Bun.spawn([process.execPath, contender, 'device', '100'], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const ip = Bun.spawn([process.execPath, contender, 'ip', '100'], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [deviceExit, ipExit] = await Promise.all([device.exited, ip.exited]);
  expect([deviceExit, ipExit]).toEqual([0, 0]);
  expect(loadConfig()).toMatchObject({
    deviceId: 'concurrent-device',
    collectLocalIpAddress: true,
  });
});

test('v4 migration auto-enables grok on pre-existing enabledAdapters lists', () => {
  const migrated = applyAdapterEnableMigrations(3, ['claude-code', 'codex', 'cursor'] as never);
  expect(migrated.version).toBe(CURRENT_CONFIG_VERSION);
  expect(migrated.adapters).toContain('grok');
  expectToContainAll(migrated.adapters, ['claude-code', 'codex', 'cursor', 'grok']);
});

test('v5 migration adds file adapters without re-enabling grok', () => {
  const migrated = applyAdapterEnableMigrations(4, ['claude-code', 'cursor'] as never);
  expect(migrated.version).toBe(CURRENT_CONFIG_VERSION);
  expect(migrated.adapters).not.toContain('grok');
  expectToContainAll(migrated.adapters, [
    'claude-code',
    'cursor',
    'antigravity',
    'kiro-cli',
    'windsurf',
  ]);
});

test('v6 migration enables Command Code without re-enabling earlier adapters', () => {
  const migrated = applyAdapterEnableMigrations(5, ['claude-code', 'cursor'] as never);
  expect(migrated.version).toBe(CURRENT_CONFIG_VERSION);
  expect(migrated.adapters).toContain('commandcode');
  expect(migrated.adapters).not.toContain('grok');
  expect(migrated.adapters).not.toContain('antigravity');
  expectToContainAll(migrated.adapters, ['claude-code', 'cursor', 'commandcode']);
});

test('v8 migration enables T3 Code without re-enabling earlier adapters', () => {
  const migrated = applyAdapterEnableMigrations(7, ['claude-code', 'cursor'] as never);
  expect(migrated.version).toBe(CURRENT_CONFIG_VERSION);
  expect(migrated.adapters).toContain('t3-code');
  expect(migrated.adapters).not.toContain('grok');
  expect(migrated.adapters).not.toContain('omp');
  expectToContainAll(migrated.adapters, ['claude-code', 'cursor', 't3-code']);
});

test('v4 migration leaves empty adapter lists empty so defaults can apply', () => {
  // Login and other writers may persist [] with an older configVersion.
  // Freezing that to ['grok'] would skip catalog defaults and break indexing.
  const migrated = applyAdapterEnableMigrations(3, []);
  expect(migrated.version).toBe(CURRENT_CONFIG_VERSION);
  expect(migrated.adapters).toEqual([]);
});

test('login-style empty adapters still resolve to catalog defaults', async () => {
  await useTempConfigDir();

  // Simulate login writing cloud session fields without a frozen adapter list.
  saveConfig({
    configVersion: 3,
    cloudToken: 'cloud-session',
    convexUrl: 'http://127.0.0.1:3210',
    enabledAdapters: [],
    customPlanDirs: [],
  });

  const loaded = loadConfig();
  expect(loaded?.enabledAdapters).toEqual([]);
  expect(loaded?.configVersion).toBe(CURRENT_CONFIG_VERSION);

  const inited = await loadOrInitConfig();
  expect(inited.enabledAdapters.length).toBeGreaterThan(1);
  expect(inited.enabledAdapters).toContain('cursor');
  expect(inited.enabledAdapters).toContain('grok');
});

test('loadConfig migrates v3 on-disk config and loadOrInitConfig persists it', async () => {
  const configDir = await useTempConfigDir();
  await mkdir(configDir, { recursive: true });
  const path = getConfigPath();
  writeFileSync(
    path,
    JSON.stringify(
      {
        configVersion: 3,
        token: 'a'.repeat(64),
        deviceId: 'device-1',
        enabledAdapters: ['claude-code', 'codex', 'cursor'],
        customPlanDirs: [],
      },
      null,
      2,
    ),
  );

  const loaded = loadConfig();
  expect(loaded?.enabledAdapters).toContain('grok');
  expect(loaded?.configVersion).toBe(CURRENT_CONFIG_VERSION);

  const inited = await loadOrInitConfig();
  expect(inited.enabledAdapters).toContain('grok');
  expect(inited.configVersion).toBe(CURRENT_CONFIG_VERSION);

  const onDisk = JSON.parse(await Bun.file(path).text()) as {
    configVersion: number;
    enabledAdapters: string[];
  };
  expect(onDisk.configVersion).toBe(CURRENT_CONFIG_VERSION);
  expect(onDisk.enabledAdapters).toContain('grok');
});

test('isHomeRelativePath recognizes the tilde forms a user can actually type', () => {
  expect(isHomeRelativePath('~')).toBe(true);
  expect(isHomeRelativePath('~/plans')).toBe(true);
  expect(isHomeRelativePath('plans')).toBe(false);
  expect(isHomeRelativePath('~plans')).toBe(false);
  expect(isHomeRelativePath('/tmp/~/plans')).toBe(false);

  // Neither cmd nor PowerShell expands `~` in arguments, so Windows users type
  // the backslash form. On POSIX a backslash is a legal filename character, so
  // `~\plans` there is a relative path named "~\plans", not a home path.
  expect(isHomeRelativePath('~\\plans')).toBe(sep === '\\');
});

test('removeCustomPlanDir removes an exactly matching normalized path', () => {
  const dirs = ['/tmp/a', '/tmp/b'];
  const updated = removeCustomPlanDir(dirs, '/tmp/a/');
  expect(updated).toEqual(['/tmp/b']);
});

test('removeCustomPlanDir returns null when nothing matches', () => {
  const dirs = ['/tmp/a', '/tmp/b'];
  expect(removeCustomPlanDir(dirs, '/tmp/nope')).toBeNull();
});

test('Given a malformed stored entry When removing another source Then the malformed entry is preserved', () => {
  const dirs = ['', '/tmp/a', '/tmp/b'];

  expect(removeCustomPlanDir(dirs, '/tmp/a')).toEqual(['', '/tmp/b']);
});

test('removeCustomPlanDir matches via realpath when given a symlink to a stored dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agendex-remove-'));
  try {
    const real = join(root, 'real');
    const link = join(root, 'link');
    await mkdir(real);
    await symlink(real, link);

    const stored = [resolveCustomPlanDirPath(real)];
    const updated = removeCustomPlanDir(stored, link);

    expect(updated).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('removeCustomPlanDir removes a stored symlink alias when removing the real path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agendex-remove-alias-'));
  try {
    const real = join(root, 'real');
    const link = join(root, 'link');
    await mkdir(real);
    await symlink(real, link);

    const stored = [resolveCustomPlanDirPath(real), resolveCustomPlanDirPath(link)];
    const updated = removeCustomPlanDir(stored, real);

    expect(updated).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('removeCustomPlanDir removes a stored real path alias when removing the symlink path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agendex-remove-alias-'));
  try {
    const real = join(root, 'real');
    const link = join(root, 'link');
    await mkdir(real);
    await symlink(real, link);

    const stored = [resolveCustomPlanDirPath(real), resolveCustomPlanDirPath(link)];
    const updated = removeCustomPlanDir(stored, link);

    expect(updated).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lastPlanDownload round-trips through save/load and drops malformed entries', async () => {
  await useTempConfigDir();
  const record = {
    at: 1_700_000_000_000,
    title: 'Add auth',
    agent: 'claude-code',
    format: 'md' as const,
    destination: '/plans/Add auth.md',
  };
  saveConfig({
    configVersion: CURRENT_CONFIG_VERSION,
    enabledAdapters: [],
    customPlanDirs: [],
    lastPlanDownload: record,
  });
  expect(loadConfig()?.lastPlanDownload).toEqual(record);

  writeFileSync(
    getConfigPath(),
    JSON.stringify({
      configVersion: CURRENT_CONFIG_VERSION,
      enabledAdapters: [],
      customPlanDirs: [],
      lastPlanDownload: { at: 'yesterday', title: 'x', agent: 'y', format: 'md' },
    }),
  );
  expect(loadConfig()?.lastPlanDownload).toBeUndefined();
});

// chmod is a no-op for Windows ACLs, so the mode assertions only hold on POSIX.
const posixOnly = test.skipIf(process.platform === 'win32');

posixOnly('config dir and file are written owner-only', async () => {
  const configDir = await useTempConfigDir();
  saveConfig({ configVersion: CURRENT_CONFIG_VERSION, enabledAdapters: [], customPlanDirs: [] });

  expect(statSync(configDir).mode & 0o777).toBe(0o700);
  expect(statSync(getConfigPath()).mode & 0o777).toBe(0o600);
});

posixOnly('loading tightens permissions of an existing world-readable config', async () => {
  const configDir = await useTempConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify({ configVersion: 8, token: 'kept' }));
  chmodSync(configDir, 0o755);
  chmodSync(getConfigPath(), 0o644);

  expect(loadConfig()?.token).toBe('kept');
  expect(statSync(configDir).mode & 0o777).toBe(0o700);
  expect(statSync(getConfigPath()).mode & 0o777).toBe(0o600);
});

test('a corrupt config is backed up and never silently replaced', async () => {
  const configDir = await useTempConfigDir();
  mkdirSync(configDir, { recursive: true });
  const corrupt = '{"token": "local-secret", "cloudToken": "cloud-secret",';
  writeFileSync(getConfigPath(), corrupt);
  const warn = console.warn;
  console.warn = () => {};
  try {
    // Read-only callers see no config but nothing is touched.
    expect(loadConfig()).toBeNull();
    expect(readFileSync(getConfigPath(), 'utf-8')).toBe(corrupt);

    let updaterCalled = false;
    expect(() =>
      updateConfig((current) => {
        updaterCalled = true;
        return current;
      }),
    ).toThrow('not valid JSON');
    expect(updaterCalled).toBe(false);

    // The original bytes survive in a timestamped backup; config.json is gone, not rewritten.
    const backups = readdirSync(configDir).filter((name) =>
      name.startsWith('config.json.corrupt-'),
    );
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(configDir, backups[0] as string), 'utf-8')).toBe(corrupt);
    expect(loadConfig()).toBeNull();

    // With the backup on disk, the next writer starts a fresh config.
    const token = loadOrCreateToken();
    expect(loadConfig()?.token).toBe(token);
  } finally {
    console.warn = warn;
  }
});
