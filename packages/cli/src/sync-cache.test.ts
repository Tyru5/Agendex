import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import type { SyncPlanPayload } from './api.ts';
import { computePayloadHash, loadSyncCache, saveSyncCache } from './sync-cache.ts';

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
  expect(loadSyncCache('account-a')).toEqual({ 'plan-1': 'hash-a' });
});

test('ignores legacy account-agnostic cache files', () => {
  const configDir = useTempConfigDir();
  writeFileSync(join(configDir, 'sync-cache.json'), JSON.stringify({ 'plan-1': 'legacy-hash' }));

  expect(loadSyncCache('account-a')).toEqual({});
});

function payloadWithGit(git: Record<string, unknown>): SyncPlanPayload {
  return {
    localPlanId: 'plan-1',
    agent: 'codex',
    title: 'Plan',
    content: 'body',
    format: 'md',
    metadata: { git },
  };
}

test('payload hash ignores volatile git branch/commit but tracks repo changes', () => {
  const repo = { host: 'github.com', owner: 'acme', name: 'widgets' };
  const onMain = payloadWithGit({ branch: 'main', commit: 'aaa111', repo });
  const onFeature = payloadWithGit({ branch: 'feat/x', commit: 'bbb222', repo });
  const otherRepo = payloadWithGit({
    branch: 'main',
    commit: 'aaa111',
    repo: { ...repo, name: 'gadgets' },
  });
  const withoutGit: SyncPlanPayload = { ...onMain, metadata: {} };

  expect(computePayloadHash(onFeature)).toBe(computePayloadHash(onMain));
  expect(computePayloadHash(otherRepo)).not.toBe(computePayloadHash(onMain));
  expect(computePayloadHash(withoutGit)).not.toBe(computePayloadHash(onMain));
});
