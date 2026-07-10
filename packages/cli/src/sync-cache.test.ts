import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { loadSyncCache, saveSyncCache } from './sync-cache.ts';

const originalConfigDir = process.env.AGENDEX_CONFIG_DIR;
let tempRoot = '';

function useTempConfigDir(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'agendex sync cache '));
  const configDir = join(tempRoot, '.agendex');
  process.env.AGENDEX_CONFIG_DIR = configDir;
  mkdirSync(configDir, { recursive: true });
  return configDir;
}

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalConfigDir;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

test('loads cache entries only for the matching cloud credential scope', () => {
  useTempConfigDir();

  saveSyncCache({ 'plan-1': 'hash-a' }, { scope: 'account-a', replace: true });
  expect(loadSyncCache('account-a')).toEqual({ 'plan-1': 'hash-a' });
  expect(loadSyncCache('account-b')).toEqual({});

  saveSyncCache({ 'plan-1': 'hash-b' }, { scope: 'account-b', replace: true });
  expect(loadSyncCache('account-b')).toEqual({ 'plan-1': 'hash-b' });
  expect(loadSyncCache('account-a')).toEqual({});
});

test('ignores legacy account-agnostic cache files', () => {
  const configDir = useTempConfigDir();
  writeFileSync(join(configDir, 'sync-cache.json'), JSON.stringify({ 'plan-1': 'legacy-hash' }));

  expect(loadSyncCache('account-a')).toEqual({});
});
