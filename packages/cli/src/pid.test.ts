import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { acquireDaemonStartLock } from './pid.ts';

const originalConfigDir = process.env.AGENDEX_CONFIG_DIR;
let tempRoot = '';

function useTempConfigDir() {
  tempRoot = mkdtempSync(join(tmpdir(), 'agendex pid path with spaces '));
  process.env.AGENDEX_CONFIG_DIR = join(tempRoot, '.agendex');
  mkdirSync(process.env.AGENDEX_CONFIG_DIR, { recursive: true });
}

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalConfigDir;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

test('daemon startup lock is exclusive and releases on paths with spaces', () => {
  useTempConfigDir();
  const release = acquireDaemonStartLock();
  expect(typeof release).toBe('function');
  const lock = JSON.parse(
    readFileSync(join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock'), 'utf8'),
  ) as { ownerToken?: unknown };
  expect(typeof lock.ownerToken).toBe('string');
  expect(acquireDaemonStartLock()).toBeNull();
  release?.();
  const reacquired = acquireDaemonStartLock();
  expect(typeof reacquired).toBe('function');
  reacquired?.();
});

test('daemon startup lock replaces a stale owner', () => {
  useTempConfigDir();
  writeFileSync(
    join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock'),
    JSON.stringify({ pid: 99_999_999, createdAtMs: 0 }),
  );
  const release = acquireDaemonStartLock();
  expect(typeof release).toBe('function');
  expect(acquireDaemonStartLock()).toBeNull();
  release?.();
});

test('does not reclaim an incomplete lock without ownership metadata', () => {
  useTempConfigDir();
  writeFileSync(join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock'), '');

  expect(acquireDaemonStartLock()).toBeNull();
});

test('an old release callback cannot remove a replacement lock', () => {
  useTempConfigDir();
  const path = join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock');
  const releaseOld = acquireDaemonStartLock();
  expect(typeof releaseOld).toBe('function');

  unlinkSync(path);
  const releaseReplacement = acquireDaemonStartLock();
  expect(typeof releaseReplacement).toBe('function');

  releaseOld?.();
  expect(acquireDaemonStartLock()).toBeNull();

  releaseReplacement?.();
  const releaseAfterReplacement = acquireDaemonStartLock();
  expect(typeof releaseAfterReplacement).toBe('function');
  releaseAfterReplacement?.();
});
