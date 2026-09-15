import { expect, test } from 'bun:test';
import { safeExportPathSegment, toBackupJsonValue } from './readable-obfuscation-export.ts';

test('encrypted backup JSON preserves Convex byte fields as canonical base64', () => {
  const encoded = toBackupJsonValue({
    envelope: {
      nonce: new Uint8Array([1, 2, 3]),
      ciphertext: new Uint8Array([4, 5]).buffer,
    },
    missing: undefined,
  });

  expect(encoded).toEqual({
    envelope: {
      nonce: { $bytes: 'AQID' },
      ciphertext: { $bytes: 'BAU=' },
    },
  });
});

test('export paths cannot escape the archive directory', () => {
  expect(safeExportPathSegment('../../secrets.txt')).toBe('.._.._secrets.txt');
  expect(safeExportPathSegment('folder\\secret.txt')).toBe('folder_secret.txt');
  expect(safeExportPathSegment('bad\u0000name')).toBe('bad_name');
  expect(safeExportPathSegment('..')).toBe('file');
});
