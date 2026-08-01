import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUiBundleStore, type UiBundleStore } from './store.ts';

const SHIPPED_REVISION = 1_700_000_000;

let workDir: string;
let rootDir: string;
let shippedDir: string;

function writeStamp(dir: string, revision: number, minShellVersion = '1.0.0') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'ui-bundle.json'),
    JSON.stringify({ revision, label: `r${revision}`, minShellVersion }),
    'utf8',
  );
}

function makeStore(shellVersion = '1.4.15'): UiBundleStore {
  return createUiBundleStore({ rootDir, shippedDir, shellVersion, log: () => undefined });
}

/** Writes a downloaded bundle and points the store at it. */
function installBundleAt(store: UiBundleStore, revision: number, minShellVersion = '1.0.0') {
  writeStamp(store.bundleDir(revision), revision, minShellVersion);
  store.activate(revision);
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'agendex-ui-store-'));
  rootDir = join(workDir, 'ui');
  shippedDir = join(workDir, 'shipped');
  mkdirSync(rootDir, { recursive: true });
  writeStamp(shippedDir, SHIPPED_REVISION);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test('serves the shipped UI when nothing has been downloaded', () => {
  expect(makeStore().resolveActiveDir()).toBe(shippedDir);
});

test('serves a downloaded bundle that outranks the shipped UI', () => {
  const store = makeStore();
  installBundleAt(store, SHIPPED_REVISION + 100);
  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));
});

test('falls back when the bundle needs a newer shell', () => {
  const store = makeStore('1.4.15');
  installBundleAt(store, SHIPPED_REVISION + 100, '1.9.0');
  expect(store.resolveActiveDir()).toBe(shippedDir);
});

test('falls back when the shipped UI is at least as new', () => {
  // After an app upgrade the shipped client can be newer than a bundle
  // downloaded before it; a fresh install must never regress.
  const store = makeStore();
  installBundleAt(store, SHIPPED_REVISION - 1);
  expect(store.resolveActiveDir()).toBe(shippedDir);

  const tie = makeStore();
  installBundleAt(tie, SHIPPED_REVISION);
  expect(tie.resolveActiveDir()).toBe(shippedDir);
});

test('falls back when the bundle directory lost its stamp', () => {
  const store = makeStore();
  const revision = SHIPPED_REVISION + 100;
  mkdirSync(store.bundleDir(revision), { recursive: true });
  store.activate(revision);
  expect(store.resolveActiveDir()).toBe(shippedDir);
});

test('treats a missing shipped stamp as revision 0', () => {
  rmSync(join(shippedDir, 'ui-bundle.json'), { force: true });
  const store = makeStore();
  expect(store.shippedStamp().revision).toBe(0);
  installBundleAt(store, 5);
  expect(store.resolveActiveDir()).toBe(store.bundleDir(5));
});

test('quarantine reverts to the shipped UI and survives a restart', () => {
  const store = makeStore();
  const revision = SHIPPED_REVISION + 100;
  installBundleAt(store, revision);
  expect(store.resolveActiveDir()).toBe(store.bundleDir(revision));

  store.quarantine(revision);
  expect(store.resolveActiveDir()).toBe(shippedDir);

  // A fresh store reads the same on-disk state, so the bad revision stays
  // blocked even if it is re-downloaded.
  const restarted = makeStore();
  expect(restarted.readState().quarantined).toContain(revision);
  restarted.activate(revision);
  expect(restarted.resolveActiveDir()).toBe(shippedDir);
});

test('activation is pending until the renderer confirms it booted', () => {
  const store = makeStore();
  installBundleAt(store, SHIPPED_REVISION + 100);
  expect(store.readState().pendingVerify).toBe(true);

  store.confirmActive();
  expect(store.readState().pendingVerify).toBe(false);
});

test('revertToShipped drops the active bundle without blocklisting it', () => {
  const store = makeStore();
  const revision = SHIPPED_REVISION + 100;
  installBundleAt(store, revision);

  store.revertToShipped();
  expect(store.resolveActiveDir()).toBe(shippedDir);
  expect(store.readState().quarantined).toHaveLength(0);
});

test('prune keeps the active and next-newest bundle, and clears staging', () => {
  const store = makeStore();
  const active = SHIPPED_REVISION + 300;
  for (const revision of [SHIPPED_REVISION + 100, SHIPPED_REVISION + 200, active]) {
    writeStamp(store.bundleDir(revision), revision);
  }
  mkdirSync(store.stagingDir(SHIPPED_REVISION + 400), { recursive: true });
  store.activate(active);

  store.prune();

  expect(existsSync(store.bundleDir(active))).toBe(true);
  expect(existsSync(store.bundleDir(SHIPPED_REVISION + 200))).toBe(true);
  expect(existsSync(store.bundleDir(SHIPPED_REVISION + 100))).toBe(false);
  expect(existsSync(store.stagingDir(SHIPPED_REVISION + 400))).toBe(false);
});
