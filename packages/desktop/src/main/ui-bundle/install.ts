import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { extract } from 'tar';
import { MAX_BUNDLE_BYTES } from './config.ts';
import { STAMP_FILENAME, type UiBundleStore } from './store.ts';
import { type FetchLike, parseUiBundleStamp, type UiManifest } from './types.ts';
import { readFileSync } from 'node:fs';

export interface InstallBundleOptions {
  readonly manifest: UiManifest;
  readonly store: UiBundleStore;
  readonly rootDir: string;
  readonly fetchImpl: FetchLike;
  readonly log: (message: string, error?: unknown) => void;
  readonly onProgress?: (percent: number) => void;
}

/**
 * Downloads, verifies, and extracts a bundle, leaving it staged at
 * `rootDir/<revision>`. Does **not** activate it — the caller decides when the
 * user sees it.
 *
 * Throws on any integrity failure. Every partial artifact is cleaned up so a
 * failed attempt cannot be mistaken for a usable bundle on the next launch.
 */
export async function installBundle(options: InstallBundleOptions): Promise<void> {
  const { manifest, store, rootDir, fetchImpl, log, onProgress } = options;
  const { revision } = manifest;

  if (manifest.size > MAX_BUNDLE_BYTES) {
    throw new Error(`bundle ${revision} declares ${manifest.size} bytes, over the ceiling`);
  }

  if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true });

  const archivePath = join(rootDir, `.download-${revision}.tar.gz`);
  const staging = store.stagingDir(revision);
  const target = store.bundleDir(revision);

  const cleanup = () => {
    rmSync(archivePath, { force: true });
    rmSync(staging, { recursive: true, force: true });
  };

  cleanup();

  try {
    const response = await fetchImpl(manifest.url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`bundle download failed with HTTP ${response.status}`);
    }

    const hash = createHash('sha256');
    let received = 0;

    // Hash on the way past rather than re-reading the file afterwards, and cap
    // the transfer so a lying manifest cannot fill the disk.
    const tap = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > manifest.size) {
          callback(new Error('bundle is larger than its manifest declares'));
          return;
        }
        hash.update(chunk);
        onProgress?.(Math.round((received / manifest.size) * 100));
        callback(null, chunk);
      },
    });

    // `fetch` returns the DOM/Bun ReadableStream while `Readable.fromWeb` is
    // typed against node:stream/web. They are the same object at runtime; only
    // the two type declarations disagree.
    const body = response.body as unknown as NodeReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(body), tap, createWriteStream(archivePath));

    if (received !== manifest.size) {
      throw new Error(`bundle is ${received} bytes, manifest declares ${manifest.size}`);
    }

    const digest = hash.digest('hex');
    if (digest !== manifest.sha256) {
      throw new Error(`bundle checksum mismatch (expected ${manifest.sha256}, got ${digest})`);
    }

    mkdirSync(staging, { recursive: true });
    // node-tar refuses absolute paths and `..` traversal by default; `strict`
    // promotes its warnings to errors so a malformed entry fails the install
    // instead of being silently skipped.
    await extract({ file: archivePath, cwd: staging, strict: true });

    const stamp = parseUiBundleStamp(
      JSON.parse(readFileSync(join(staging, STAMP_FILENAME), 'utf8')),
    );
    if (!stamp) throw new Error('extracted bundle has no readable stamp');
    if (stamp.revision !== revision) {
      throw new Error(`extracted bundle is revision ${stamp.revision}, expected ${revision}`);
    }
    if (!existsSync(join(staging, 'index.html'))) {
      throw new Error('extracted bundle has no index.html');
    }

    // Rename onto a path that definitely does not exist: renaming over a
    // directory fails on Windows.
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
    rmSync(archivePath, { force: true });
    log(`ui-update: staged bundle ${revision} (${stamp.label})`);
  } catch (error) {
    cleanup();
    throw error instanceof Error ? error : new Error(String(error));
  }
}
