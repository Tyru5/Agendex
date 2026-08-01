import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBundle } from './install.ts';
import { createUiBundleStore, type UiBundleStore } from './store.ts';
import type { FetchLike, UiManifest } from './types.ts';

const REVISION = 1_800_000_000;

// A hand-rolled tar writer, so tests can produce archives node-tar's `create`
// would refuse to emit — notably a path-traversal entry.
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8'); // mode
  header.write('0000000\0', 108, 8, 'utf8'); // uid
  header.write('0000000\0', 116, 8, 'utf8'); // gid
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write('00000000000\0', 136, 12, 'utf8'); // mtime
  header.write('        ', 148, 8, 'utf8'); // checksum field counts as spaces
  header.write('0', 156, 1, 'utf8'); // regular file
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');

  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return header;
}

function tarEntry(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([tarHeader(name, data.length), data, padding]);
}

function makeArchive(entries: [string, string][]): Buffer {
  return gzipSync(
    Buffer.concat([
      ...entries.map(([name, content]) => tarEntry(name, content)),
      Buffer.alloc(1024), // end-of-archive marker
    ]),
  );
}

function validEntries(revision = REVISION): [string, string][] {
  return [
    ['./index.html', '<!doctype html><title>agendex</title>'],
    [
      './ui-bundle.json',
      JSON.stringify({ revision, label: `r${revision}`, minShellVersion: '1.0.0' }),
    ],
  ];
}

let workDir: string;
let rootDir: string;
let store: UiBundleStore;

function manifestFor(archive: Buffer, overrides: Partial<UiManifest> = {}): UiManifest {
  return {
    revision: REVISION,
    label: `r${REVISION}`,
    minShellVersion: '1.0.0',
    url: 'https://example.test/bundle.tar.gz',
    sha256: createHash('sha256').update(archive).digest('hex'),
    size: archive.length,
    ...overrides,
  };
}

function fetchReturning(archive: Buffer): FetchLike {
  return async () => new Response(new Uint8Array(archive), { status: 200 });
}

async function install(archive: Buffer, overrides: Partial<UiManifest> = {}) {
  await installBundle({
    manifest: manifestFor(archive, overrides),
    store,
    rootDir,
    fetchImpl: fetchReturning(archive),
    log: () => undefined,
  });
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'agendex-ui-install-'));
  rootDir = join(workDir, 'ui');
  const shippedDir = join(workDir, 'shipped');
  mkdirSync(rootDir, { recursive: true });
  mkdirSync(shippedDir, { recursive: true });
  writeFileSync(
    join(shippedDir, 'ui-bundle.json'),
    JSON.stringify({ revision: 1, label: 'shipped', minShellVersion: '1.0.0' }),
    'utf8',
  );
  store = createUiBundleStore({
    rootDir,
    shippedDir,
    shellVersion: '1.4.15',
    log: () => undefined,
  });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test('extracts a verified bundle into its revision directory', async () => {
  await install(makeArchive(validEntries()));

  expect(existsSync(join(store.bundleDir(REVISION), 'index.html'))).toBe(true);
  expect(existsSync(join(store.bundleDir(REVISION), 'ui-bundle.json'))).toBe(true);
});

test('leaves no download or staging artifacts behind on success', async () => {
  await install(makeArchive(validEntries()));

  const leftovers = readdirSync(rootDir).filter((name) => name.startsWith('.'));
  expect(leftovers).toHaveLength(0);
});

test('rejects a bundle whose checksum does not match the manifest', async () => {
  const archive = makeArchive(validEntries());
  await expect(install(archive, { sha256: 'c'.repeat(64) })).rejects.toThrow(/checksum mismatch/);
  expect(existsSync(store.bundleDir(REVISION))).toBe(false);
});

test('rejects a bundle larger than the manifest declares', async () => {
  const archive = makeArchive(validEntries());
  await expect(install(archive, { size: archive.length - 10 })).rejects.toThrow(/larger than/);
  expect(existsSync(store.bundleDir(REVISION))).toBe(false);
});

test('rejects a truncated bundle', async () => {
  const archive = makeArchive(validEntries());
  await expect(install(archive, { size: archive.length + 10 })).rejects.toThrow(
    /manifest declares/,
  );
});

test('rejects a bundle whose stamp disagrees with the manifest', async () => {
  // Guards against a mixed-up publish: the archive must be the revision the
  // signed manifest promised.
  const archive = makeArchive(validEntries(REVISION + 5));
  await expect(install(archive)).rejects.toThrow(/expected/);
  expect(existsSync(store.bundleDir(REVISION))).toBe(false);
});

test('rejects a bundle with no index.html', async () => {
  const archive = makeArchive([
    [
      './ui-bundle.json',
      JSON.stringify({ revision: REVISION, label: 'x', minShellVersion: '1.0.0' }),
    ],
  ]);
  await expect(install(archive)).rejects.toThrow(/index\.html/);
});

test('cleans up after a failed install so the next attempt starts fresh', async () => {
  const archive = makeArchive(validEntries());
  await expect(install(archive, { sha256: 'd'.repeat(64) })).rejects.toThrow();

  expect(existsSync(store.stagingDir(REVISION))).toBe(false);
  expect(readdirSync(rootDir).filter((name) => name.startsWith('.download'))).toHaveLength(0);

  // And a subsequent good install still works.
  await install(archive);
  expect(existsSync(join(store.bundleDir(REVISION), 'index.html'))).toBe(true);
});

test('never writes outside the bundle directory, even with a traversal entry', async () => {
  const archive = makeArchive([...validEntries(), ['../escaped.txt', 'pwned']]);

  // node-tar may either refuse the entry or strip the traversal; both are fine.
  // What must hold is that nothing lands outside the target directory.
  await install(archive).catch(() => undefined);

  expect(existsSync(join(rootDir, 'escaped.txt'))).toBe(false);
  expect(existsSync(join(workDir, 'escaped.txt'))).toBe(false);
  expect(existsSync(join(workDir, '..', 'escaped.txt'))).toBe(false);
});

test('refuses a manifest declaring an absurd size before downloading anything', async () => {
  let fetched = false;
  await expect(
    installBundle({
      manifest: manifestFor(Buffer.alloc(0), { size: 1024 ** 4 }),
      store,
      rootDir,
      fetchImpl: async () => {
        fetched = true;
        return new Response(new Uint8Array(), { status: 200 });
      },
      log: () => undefined,
    }),
  ).rejects.toThrow(/ceiling/);
  expect(fetched).toBe(false);
});
