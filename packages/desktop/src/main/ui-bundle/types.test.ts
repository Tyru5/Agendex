import { expect, test } from 'bun:test';
import { parseUiBundleStamp, parseUiManifest } from './types.ts';

const VALID_MANIFEST = {
  revision: 1753920000,
  label: '2025-07-31 (abc1234)',
  minShellVersion: '1.4.15',
  url: 'https://example.test/agendex-ui-1753920000.tar.gz',
  sha256: 'a'.repeat(64),
  size: 2_500_000,
};

test('parses a well-formed stamp', () => {
  expect(parseUiBundleStamp({ revision: 12, label: 'x', minShellVersion: '1.0.0' })).toEqual({
    revision: 12,
    label: 'x',
    minShellVersion: '1.0.0',
  });
});

test('rejects stamps with an unusable revision or shell floor', () => {
  expect(parseUiBundleStamp(null)).toBeNull();
  expect(parseUiBundleStamp({ revision: -1, minShellVersion: '1.0.0' })).toBeNull();
  expect(parseUiBundleStamp({ revision: 1.5, minShellVersion: '1.0.0' })).toBeNull();
  expect(parseUiBundleStamp({ revision: 1 })).toBeNull();
  expect(parseUiBundleStamp({ revision: 1, minShellVersion: '  ' })).toBeNull();
});

test('parses a well-formed manifest', () => {
  expect(parseUiManifest(VALID_MANIFEST)).toEqual({ ...VALID_MANIFEST, pinToShipped: false });
});

test('rejects manifests whose integrity fields are unusable', () => {
  expect(parseUiManifest({ ...VALID_MANIFEST, sha256: 'nope' })).toBeNull();
  expect(parseUiManifest({ ...VALID_MANIFEST, sha256: 'A'.repeat(64) })).toBeNull();
  expect(parseUiManifest({ ...VALID_MANIFEST, size: 0 })).toBeNull();
  expect(parseUiManifest({ ...VALID_MANIFEST, size: -5 })).toBeNull();
  expect(parseUiManifest({ ...VALID_MANIFEST, url: '' })).toBeNull();
  // A non-http scheme must never reach the downloader.
  expect(parseUiManifest({ ...VALID_MANIFEST, url: 'file:///etc/passwd' })).toBeNull();
});

test('honours the kill switch without requiring a bundle to point at', () => {
  const pinned = parseUiManifest({
    revision: 1753920000,
    label: 'pinned',
    minShellVersion: '1.4.15',
    pinToShipped: true,
  });
  expect(pinned?.pinToShipped).toBe(true);
  expect(pinned?.url).toBe('');
});
