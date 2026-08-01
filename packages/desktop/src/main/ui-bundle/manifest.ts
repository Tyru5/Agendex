import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { getUiSignatureUrl } from './config.ts';
import { type FetchLike, parseUiManifest, type UiManifest } from './types.ts';

/**
 * Verifies a detached Ed25519 signature over the *raw manifest bytes*.
 *
 * Signing the bytes rather than a re-serialized object sidesteps JSON
 * canonicalization entirely: there is exactly one byte sequence to agree on,
 * and the publisher and the shell both see it verbatim.
 */
export function verifyManifestSignature(
  rawManifest: Uint8Array,
  signature: Uint8Array,
  publicKeyPem: string,
): boolean {
  if (publicKeyPem.trim() === '') return false;
  try {
    const key = createPublicKey(publicKeyPem);
    // Ed25519 is a one-shot algorithm: node requires a null digest name here.
    return verifySignature(null, rawManifest, key, signature);
  } catch {
    // Malformed key or signature is indistinguishable from a bad signature as
    // far as the caller is concerned: do not install.
    return false;
  }
}

export interface FetchManifestOptions {
  readonly feedUrl: string;
  readonly publicKeyPem: string;
  readonly fetchImpl: FetchLike;
  readonly log: (message: string, error?: unknown) => void;
  /** Cache buster; injected so tests stay deterministic. */
  readonly now: () => number;
}

function bust(url: string, now: number): string {
  // GitHub caches release assets aggressively and the feed URL is a fixed tag,
  // so without this a publish can take a long time to become visible.
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${now}`;
}

async function fetchBytes(
  fetchImpl: FetchLike,
  url: string,
  now: number,
): Promise<Uint8Array | null> {
  const response = await fetchImpl(bust(url, now), {
    redirect: 'follow',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Fetches and authenticates the feed. Returns null for every failure mode —
 * offline, 404, bad signature, malformed body — because they all mean the same
 * thing to the caller: keep running the UI you already have.
 */
export async function fetchSignedManifest(
  options: FetchManifestOptions,
): Promise<UiManifest | null> {
  const { feedUrl, publicKeyPem, fetchImpl, log, now } = options;
  const timestamp = now();

  try {
    const [rawManifest, signature] = await Promise.all([
      fetchBytes(fetchImpl, feedUrl, timestamp),
      fetchBytes(fetchImpl, getUiSignatureUrl(feedUrl), timestamp),
    ]);

    if (!rawManifest || !signature) {
      log('ui-update: manifest or signature unavailable');
      return null;
    }

    if (!verifyManifestSignature(rawManifest, signature, publicKeyPem)) {
      log('ui-update: manifest signature did not verify; ignoring feed');
      return null;
    }

    // Parse only after the signature verifies, so malformed-input handling is
    // never exposed to unauthenticated bytes.
    const parsed = parseUiManifest(JSON.parse(Buffer.from(rawManifest).toString('utf8')));
    if (!parsed) {
      log('ui-update: manifest verified but failed validation');
      return null;
    }
    return parsed;
  } catch (error) {
    log('ui-update: manifest fetch failed', error);
    return null;
  }
}
