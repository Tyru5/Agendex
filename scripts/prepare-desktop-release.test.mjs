import { describe, expect, test } from 'bun:test';
import { updateDownloadPageVersion } from './prepare-desktop-release.mjs';

const sampleSource = `/**
 * Latest stable desktop release advertised on /download.
 */
const DESKTOP_VERSION = '1.4.1';
const DESKTOP_TAG = \`desktop-v\${DESKTOP_VERSION}\`;
`;

describe('updateDownloadPageVersion', () => {
  test('replaces the DESKTOP_VERSION constant', () => {
    const next = updateDownloadPageVersion(sampleSource, '1.5.0');
    expect(next).toContain("const DESKTOP_VERSION = '1.5.0';");
    expect(next).not.toContain("const DESKTOP_VERSION = '1.4.1';");
    expect(next).toContain('const DESKTOP_TAG');
  });

  test('is a no-op when the version is already current', () => {
    const next = updateDownloadPageVersion(sampleSource, '1.4.1');
    expect(next).toBe(sampleSource);
  });

  test('throws when the constant is missing', () => {
    expect(() => updateDownloadPageVersion('export const x = 1;\n', '1.0.0')).toThrow(
      /DESKTOP_VERSION/,
    );
  });
});
