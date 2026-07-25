import { expect, test } from 'bun:test';
import { hasUpdatePublisherName, resolveDesktopBuildInfo } from './desktop-build-info.ts';

const UNSIGNED_APP_UPDATE_YML = `provider: generic
url: https://github.com/Tyru5/Agendex/releases/latest/download
updaterCacheDirName: agendex-updater
`;

const SIGNED_APP_UPDATE_YML = `provider: generic
url: https://github.com/Tyru5/Agendex/releases/latest/download
updaterCacheDirName: agendex-updater
publisherName:
  - Agendex LLC
`;

test('detects the publisherName electron-builder writes for signed Windows builds', () => {
  expect(hasUpdatePublisherName(SIGNED_APP_UPDATE_YML)).toBe(true);
  expect(hasUpdatePublisherName(UNSIGNED_APP_UPDATE_YML)).toBe(false);
  // Inline form, as electron-builder emits for a single publisher.
  expect(hasUpdatePublisherName('publisherName: Agendex LLC\n')).toBe(true);
  // An indented key belongs to some other mapping and must not count.
  expect(hasUpdatePublisherName('nested:\n  publisherName: Agendex LLC\n')).toBe(false);
});

test('reports an unsigned packaged Windows build', () => {
  expect(
    resolveDesktopBuildInfo({
      platform: 'win32',
      isPackaged: true,
      readAppUpdateConfig: () => UNSIGNED_APP_UPDATE_YML,
    }),
  ).toEqual({ platform: 'win32', codeSigned: false });
});

test('reports a signed packaged Windows build', () => {
  expect(
    resolveDesktopBuildInfo({
      platform: 'win32',
      isPackaged: true,
      readAppUpdateConfig: () => SIGNED_APP_UPDATE_YML,
    }),
  ).toEqual({ platform: 'win32', codeSigned: true });
});

test('leaves signing unknown for dev builds, other platforms, and unreadable configs', () => {
  const unpackaged = resolveDesktopBuildInfo({
    platform: 'win32',
    isPackaged: false,
    readAppUpdateConfig: () => UNSIGNED_APP_UPDATE_YML,
  });
  expect(unpackaged).toEqual({ platform: 'win32', codeSigned: null });

  // macOS signing is enforced by the release workflow and leaves no trace in
  // app-update.yml, so absence there must never be read as "unsigned".
  const mac = resolveDesktopBuildInfo({
    platform: 'darwin',
    isPackaged: true,
    readAppUpdateConfig: () => UNSIGNED_APP_UPDATE_YML,
  });
  expect(mac).toEqual({ platform: 'darwin', codeSigned: null });

  const unreadable = resolveDesktopBuildInfo({
    platform: 'win32',
    isPackaged: true,
    readAppUpdateConfig: () => null,
  });
  expect(unreadable).toEqual({ platform: 'win32', codeSigned: null });
});

test('does not read the update config when it cannot matter', () => {
  let reads = 0;
  resolveDesktopBuildInfo({
    platform: 'darwin',
    isPackaged: true,
    readAppUpdateConfig: () => {
      reads += 1;
      return UNSIGNED_APP_UPDATE_YML;
    },
  });
  expect(reads).toBe(0);
});
