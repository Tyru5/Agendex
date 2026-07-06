import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getConfigPath,
  loadConfig,
  loadOrCreateToken,
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
    enabledAdapters: ['cursor'],
    customPlanDirs: ['/tmp/agendex-plans'],
  });
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
