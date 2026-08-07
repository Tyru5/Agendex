import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createUiBundleStore, type UiBundleStore } from './ui-bundle/store.ts';
import type { FetchLike } from './ui-bundle/types.ts';
import { createUiUpdater, type UiUpdater } from './ui-updater.ts';

const SHIPPED_REVISION = 1_700_000_000;
const FEED_URL = 'https://feed.test/ui-manifest.json';
const BUNDLE_URL = 'https://feed.test/bundle.tar.gz';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

// Minimal tar writer; enough to produce a bundle the real installer accepts.
function tarEntry(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write('00000000000\0', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

function makeBundle(revision: number, minShellVersion = '1.0.0'): Buffer {
  return gzipSync(
    Buffer.concat([
      tarEntry('./index.html', '<!doctype html>'),
      tarEntry(
        './ui-bundle.json',
        JSON.stringify({ revision, label: `r${revision}`, minShellVersion }),
      ),
      Buffer.alloc(1024),
    ]),
  );
}

interface Feed {
  manifest: Record<string, unknown>;
  bundle: Buffer | null;
}

let workDir: string;
let rootDir: string;
let shippedDir: string;
let store: UiBundleStore;
let feed: Feed;
let reloads: number;
let promptAnswer: boolean;
let prompts: number;
let sentinels: (() => void)[];

function publish(revision: number, minShellVersion = '1.0.0') {
  const bundle = makeBundle(revision, minShellVersion);
  feed = {
    bundle,
    manifest: {
      revision,
      label: `r${revision}`,
      minShellVersion,
      url: BUNDLE_URL,
      sha256: createHash('sha256').update(bundle).digest('hex'),
      size: bundle.length,
    },
  };
}

const fakeFetch: FetchLike = async (url) => {
  if (url.startsWith(BUNDLE_URL)) {
    return feed.bundle
      ? new Response(new Uint8Array(feed.bundle), { status: 200 })
      : new Response('missing', { status: 404 });
  }
  const bytes = Buffer.from(`${JSON.stringify(feed.manifest, null, 2)}\n`, 'utf8');
  if (url.includes('.sig')) {
    return new Response(new Uint8Array(signBytes(null, bytes, privateKey)), { status: 200 });
  }
  return new Response(new Uint8Array(bytes), { status: 200 });
};

function makeUpdater(overrides: { isPackaged?: boolean; enabled?: boolean } = {}): UiUpdater {
  return createUiUpdater({
    store,
    rootDir,
    feedUrl: FEED_URL,
    publicKeyPem: PUBLIC_PEM,
    shellVersion: '1.4.15',
    fetchImpl: fakeFetch,
    isPackaged: overrides.isPackaged ?? true,
    enabled: overrides.enabled ?? true,
    promptToReload: async () => {
      prompts += 1;
      return { reloadNow: promptAnswer };
    },
    applyReload: () => {
      reloads += 1;
    },
    log: () => undefined,
    setTimeoutFn: (callback) => {
      sentinels.push(callback);
      return { unref: () => undefined };
    },
    setIntervalFn: () => ({ unref: () => undefined }),
    now: () => 1_700_000_000_000,
  });
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'agendex-ui-updater-'));
  rootDir = join(workDir, 'ui');
  shippedDir = join(workDir, 'shipped');
  mkdirSync(rootDir, { recursive: true });
  mkdirSync(shippedDir, { recursive: true });
  writeFileSync(
    join(shippedDir, 'ui-bundle.json'),
    JSON.stringify({
      revision: SHIPPED_REVISION,
      label: 'shipped',
      minShellVersion: '1.0.0',
    }),
    'utf8',
  );
  store = createUiBundleStore({
    rootDir,
    shippedDir,
    shellVersion: '1.4.15',
    log: () => undefined,
  });
  reloads = 0;
  prompts = 0;
  promptAnswer = false;
  sentinels = [];
  publish(SHIPPED_REVISION + 100);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test('is unsupported in unpackaged builds', async () => {
  const updater = makeUpdater({ isPackaged: false });
  expect(updater.isSupported).toBe(false);
  expect(updater.getState()).toEqual({ status: 'unsupported' });

  await updater.checkForUpdates();
  expect(store.resolveActiveDir()).toBe(shippedDir);
});

test('is unsupported when no signing key is baked in', () => {
  // enabled=false is what index.ts passes when hasUiBundlePublicKey() is false.
  expect(makeUpdater({ enabled: false }).isSupported).toBe(false);
});

test('downloads a newer bundle and prompts before applying it', async () => {
  const updater = makeUpdater();
  await updater.checkForUpdates();

  expect(prompts).toBe(1);
  expect(updater.getState().status).toBe('ready');
  // Declining leaves the current UI in place; it applies on the next launch.
  expect(store.resolveActiveDir()).toBe(shippedDir);
  expect(reloads).toBe(0);
});

test('accepting the prompt activates the bundle and reloads', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();

  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));
  expect(reloads).toBe(1);
});

test('applying stages the bundle as pending until the renderer confirms', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();

  expect(store.readState().pendingVerify).toBe(true);
  updater.notifyRendererReady();
  expect(store.readState().pendingVerify).toBe(false);
});

test('a bundle that never reports ready is quarantined and rolled back', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();
  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));

  // Fire the boot sentinel without a ready signal.
  for (const sentinel of sentinels) sentinel();

  expect(store.resolveActiveDir()).toBe(shippedDir);
  expect(store.readState().quarantined).toContain(SHIPPED_REVISION + 100);
  expect(reloads).toBe(2);
});

test('a confirmed bundle survives its boot sentinel firing late', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();

  updater.notifyRendererReady();
  for (const sentinel of sentinels) sentinel();

  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));
  expect(store.readState().quarantined).toHaveLength(0);
});

test('a load failure quarantines the pending bundle', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();

  updater.notifyLoadFailure();

  expect(store.resolveActiveDir()).toBe(shippedDir);
  expect(store.readState().quarantined).toContain(SHIPPED_REVISION + 100);
});

test('a quarantined revision is never reinstalled', async () => {
  store.quarantine(SHIPPED_REVISION + 100);
  const updater = makeUpdater();
  await updater.checkForUpdates();

  expect(updater.getState().status).toBe('no-update');
  expect(existsSync(store.bundleDir(SHIPPED_REVISION + 100))).toBe(false);
});

test('reports no update when the feed matches what is already served', async () => {
  publish(SHIPPED_REVISION);
  const updater = makeUpdater();
  await updater.checkForUpdates();

  expect(updater.getState().status).toBe('no-update');
  expect(prompts).toBe(0);
});

test('ignores a feed revision the shipped UI already outranks', async () => {
  publish(SHIPPED_REVISION - 100);
  const updater = makeUpdater();
  await updater.checkForUpdates();

  expect(updater.getState().status).toBe('no-update');
  expect(prompts).toBe(0);
  expect(existsSync(store.bundleDir(SHIPPED_REVISION - 100))).toBe(false);
});

test('keeps a valid activation when the feed drops to or below shipped', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();
  updater.notifyRendererReady();
  const active = SHIPPED_REVISION + 100;
  expect(store.resolveActiveDir()).toBe(store.bundleDir(active));

  // A rolling feed at/below the floor is not a kill switch; pinToShipped is.
  // The active bundle still beats the floor, so keep serving it.
  publish(SHIPPED_REVISION);
  await updater.checkForUpdates();

  expect(updater.getState().status).toBe('no-update');
  expect(prompts).toBe(1);
  expect(reloads).toBe(1);
  expect(store.readState().revision).toBe(active);
  expect(store.resolveActiveDir()).toBe(store.bundleDir(active));
  expect(store.servedRevision()).toBe(active);
});

// An upgraded shell must immediately stop serving a downloaded UI that its new floor rejects.
test('an app update that outranks the active bundle ends the prompt', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();
  updater.notifyRendererReady();
  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));

  // Installing a newer app build raises the shipped floor above the bundle the
  // feed is serving, so that bundle can never be served again. Same userData.
  writeFileSync(
    join(shippedDir, 'ui-bundle.json'),
    JSON.stringify({
      revision: SHIPPED_REVISION + 200,
      label: 'shipped',
      minShellVersion: '1.0.0',
    }),
    'utf8',
  );
  store = createUiBundleStore({
    rootDir,
    shippedDir,
    shellVersion: '1.4.15',
    log: () => undefined,
  });
  const promptsBefore = prompts;
  const upgraded = makeUpdater();

  await upgraded.checkForUpdates();
  await upgraded.checkForUpdates();

  expect(upgraded.getState().status).toBe('no-update');
  expect(prompts).toBe(promptsBefore);
  expect(reloads).toBe(2);
  expect(store.resolveActiveDir()).toBe(shippedDir);
  // The dead activation is cleared, so Settings stops naming a revision that is
  // not on screen.
  expect(store.readState().revision).toBeNull();
  expect(store.servedRevision()).toBe(SHIPPED_REVISION + 200);
});

test('skips bundles that need a newer shell without downloading them', async () => {
  publish(SHIPPED_REVISION + 200, '9.0.0');
  const updater = makeUpdater();
  await updater.checkForUpdates();

  expect(updater.getState().status).toBe('no-update');
  expect(existsSync(store.bundleDir(SHIPPED_REVISION + 200))).toBe(false);
});

test('rolls back when the feed republishes an older revision', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();
  updater.notifyRendererReady();
  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));

  // The manifest is desired state, not "newer only": republishing an earlier
  // revision is how a bad UI gets pulled back.
  publish(SHIPPED_REVISION + 50);
  await updater.checkForUpdates();
  updater.notifyRendererReady();

  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 50));
});

test('the kill switch reverts to the shipped UI without a prompt', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();
  updater.notifyRendererReady();
  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));

  const reloadsBefore = reloads;
  const promptsBefore = prompts;
  feed = {
    bundle: null,
    manifest: {
      revision: SHIPPED_REVISION + 300,
      label: 'pinned',
      minShellVersion: '1.0.0',
      pinToShipped: true,
    },
  };
  await updater.checkForUpdates();

  expect(store.resolveActiveDir()).toBe(shippedDir);
  expect(prompts).toBe(promptsBefore);
  expect(reloads).toBe(reloadsBefore + 1);
});

test('an unverifiable feed leaves the current UI untouched', async () => {
  promptAnswer = true;
  const updater = makeUpdater();
  await updater.checkForUpdates();
  updater.notifyRendererReady();

  // Sign with the wrong key from here on.
  const attacker = generateKeyPairSync('ed25519');
  const hostile = createUiUpdater({
    store,
    rootDir,
    feedUrl: FEED_URL,
    publicKeyPem: attacker.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    shellVersion: '1.4.15',
    fetchImpl: fakeFetch,
    isPackaged: true,
    enabled: true,
    promptToReload: async () => ({ reloadNow: true }),
    applyReload: () => {
      reloads += 1;
    },
    log: () => undefined,
    setTimeoutFn: () => ({ unref: () => undefined }),
    setIntervalFn: () => ({ unref: () => undefined }),
    now: () => 1_700_000_000_000,
  });

  publish(SHIPPED_REVISION + 500);
  await hostile.checkForUpdates();

  expect(hostile.getState().status).toBe('error');
  expect(existsSync(store.bundleDir(SHIPPED_REVISION + 500))).toBe(false);
  expect(store.resolveActiveDir()).toBe(store.bundleDir(SHIPPED_REVISION + 100));
});

test('reconcile quarantines a bundle that never confirmed in a previous run', () => {
  mkdirSync(store.bundleDir(SHIPPED_REVISION + 100), { recursive: true });
  writeFileSync(
    join(store.bundleDir(SHIPPED_REVISION + 100), 'ui-bundle.json'),
    JSON.stringify({ revision: SHIPPED_REVISION + 100, label: 'x', minShellVersion: '1.0.0' }),
    'utf8',
  );
  store.activate(SHIPPED_REVISION + 100);
  expect(store.readState().pendingVerify).toBe(true);

  makeUpdater().reconcilePendingVerify();

  expect(store.readState().quarantined).toContain(SHIPPED_REVISION + 100);
  expect(store.resolveActiveDir()).toBe(shippedDir);
});
