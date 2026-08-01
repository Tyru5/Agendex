import { expect, test } from 'bun:test';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { fetchSignedManifest, verifyManifestSignature } from './manifest.ts';
import type { FetchLike } from './types.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const OTHER = generateKeyPairSync('ed25519');

const MANIFEST = {
  revision: 1753920000,
  label: '2025-07-31 (abc1234)',
  minShellVersion: '1.4.15',
  url: 'https://example.test/agendex-ui-1753920000.tar.gz',
  sha256: 'b'.repeat(64),
  size: 1024,
};

function manifestBytes(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(`${JSON.stringify({ ...MANIFEST, ...overrides }, null, 2)}\n`, 'utf8');
}

function sign(bytes: Buffer, key = privateKey): Buffer {
  return signBytes(null, bytes, key);
}

/** Serves the manifest and its detached signature, ignoring the cache buster. */
function createFetch(manifest: Buffer | null, signature: Buffer | null): FetchLike {
  return async (url) => {
    const body = url.includes('.sig') ? signature : manifest;
    if (!body) return new Response('missing', { status: 404 });
    return new Response(new Uint8Array(body), { status: 200 });
  };
}

const baseOptions = {
  feedUrl: 'https://example.test/ui-manifest.json',
  publicKeyPem: PUBLIC_PEM,
  log: () => undefined,
  now: () => 1_700_000_000_000,
};

test('verifies a genuine detached signature', () => {
  const bytes = manifestBytes();
  expect(verifyManifestSignature(bytes, sign(bytes), PUBLIC_PEM)).toBe(true);
});

test('rejects a signature made by a different key', () => {
  const bytes = manifestBytes();
  expect(verifyManifestSignature(bytes, sign(bytes, OTHER.privateKey), PUBLIC_PEM)).toBe(false);
});

test('rejects a manifest modified after signing', () => {
  const bytes = manifestBytes();
  const signature = sign(bytes);
  const tampered = manifestBytes({ url: 'https://evil.test/payload.tar.gz' });
  expect(verifyManifestSignature(tampered, signature, PUBLIC_PEM)).toBe(false);
});

test('fails closed when no public key is baked in', () => {
  // An unprovisioned build must keep serving its shipped UI, not trust the feed.
  const bytes = manifestBytes();
  expect(verifyManifestSignature(bytes, sign(bytes), '')).toBe(false);
  expect(verifyManifestSignature(bytes, sign(bytes), '   ')).toBe(false);
});

test('does not throw on a malformed key or signature', () => {
  const bytes = manifestBytes();
  expect(verifyManifestSignature(bytes, Buffer.from('garbage'), PUBLIC_PEM)).toBe(false);
  expect(verifyManifestSignature(bytes, sign(bytes), 'not a pem')).toBe(false);
});

test('returns the manifest when the feed is authentic', async () => {
  const bytes = manifestBytes();
  const result = await fetchSignedManifest({
    ...baseOptions,
    fetchImpl: createFetch(bytes, sign(bytes)),
  });
  expect(result?.revision).toBe(MANIFEST.revision);
  expect(result?.url).toBe(MANIFEST.url);
});

test('returns null when the signature does not verify', async () => {
  const bytes = manifestBytes();
  const result = await fetchSignedManifest({
    ...baseOptions,
    fetchImpl: createFetch(bytes, sign(bytes, OTHER.privateKey)),
  });
  expect(result).toBeNull();
});

test('returns null when the feed is unreachable', async () => {
  const result = await fetchSignedManifest({ ...baseOptions, fetchImpl: createFetch(null, null) });
  expect(result).toBeNull();
});

test('returns null when the signature asset is missing', async () => {
  const bytes = manifestBytes();
  const result = await fetchSignedManifest({ ...baseOptions, fetchImpl: createFetch(bytes, null) });
  expect(result).toBeNull();
});

test('returns null when a signed manifest fails validation', async () => {
  // Correctly signed but structurally unusable: our own bad publish, not an
  // attack — still must not be installed.
  const bytes = manifestBytes({ sha256: 'too-short' });
  const result = await fetchSignedManifest({
    ...baseOptions,
    fetchImpl: createFetch(bytes, sign(bytes)),
  });
  expect(result).toBeNull();
});

test('survives a network error without throwing', async () => {
  const result = await fetchSignedManifest({
    ...baseOptions,
    fetchImpl: () => Promise.reject(new Error('offline')),
  });
  expect(result).toBeNull();
});
