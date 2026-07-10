import { afterEach, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyAdapterEnableMigrations,
  CURRENT_CONFIG_VERSION,
  getConfigPath,
  loadConfig,
  loadOrCreateToken,
  loadOrInitConfig,
  removeCustomPlanDir,
  resolveCustomPlanDirPath,
  saveConfig,
} from './config.ts';

const originalEnv: Record<string, string | undefined> = {
  AGENDEX_CONFIG_DIR: process.env.AGENDEX_CONFIG_DIR,
  AGENDEX_DEV: process.env.AGENDEX_DEV,
};

let tempRoot: string | undefined;

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

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

test('AGENDEX_CONFIG_DIR overrides the user config path for tests and tooling', async () => {
  const configDir = await useTempConfigDir();

  expect(getConfigPath()).toBe(join(configDir, 'config.json'));
});

test('loadOrCreateToken preserves existing cloud session fields', async () => {
  await useTempConfigDir();

  saveConfig({
    configVersion: 3,
    cloudToken: 'cloud-session',
    convexUrl: 'http://127.0.0.1:3210',
    deviceId: 'device-1',
    enabledAdapters: ['cursor'],
    customPlanDirs: ['/tmp/agendex-plans'],
  });

  const token = loadOrCreateToken();
  const config = loadConfig();

  expect(token).toHaveLength(64);
  expect(config).toMatchObject({
    token,
    cloudToken: 'cloud-session',
    convexUrl: 'http://127.0.0.1:3210',
    deviceId: 'device-1',
    // v3→v4 migration auto-enables grok for pre-existing installs.
    enabledAdapters: expect.arrayContaining([
      'cursor',
      'grok',
      'antigravity',
      'gemini-cli',
      'kiro-cli',
    ]),
    customPlanDirs: ['/tmp/agendex-plans'],
  });
  expect(config?.configVersion).toBe(CURRENT_CONFIG_VERSION);
});

test('v4 migration auto-enables grok on pre-existing enabledAdapters lists', () => {
  const migrated = applyAdapterEnableMigrations(3, ['claude-code', 'codex', 'cursor'] as never);
  expect(migrated.version).toBe(CURRENT_CONFIG_VERSION);
  expect(migrated.adapters).toContain('grok');
  expect(migrated.adapters).toEqual(
    expect.arrayContaining(['claude-code', 'codex', 'cursor', 'grok']),
  );
});

test('v5 migration adds file adapters without re-enabling grok', () => {
  const migrated = applyAdapterEnableMigrations(4, ['claude-code', 'cursor'] as never);
  expect(migrated.version).toBe(CURRENT_CONFIG_VERSION);
  expect(migrated.adapters).not.toContain('grok');
  expect(migrated.adapters).toEqual(
    expect.arrayContaining(['claude-code', 'cursor', 'antigravity', 'kiro-cli', 'windsurf']),
  );
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

test('removeCustomPlanDir removes an exactly matching normalized path', () => {
  const dirs = ['/tmp/a', '/tmp/b'];
  const updated = removeCustomPlanDir(dirs, '/tmp/a/');
  expect(updated).toEqual(['/tmp/b']);
});

test('removeCustomPlanDir returns null when nothing matches', () => {
  const dirs = ['/tmp/a', '/tmp/b'];
  expect(removeCustomPlanDir(dirs, '/tmp/nope')).toBeNull();
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
