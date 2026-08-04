import { afterEach, describe, expect, test } from 'bun:test';
import { buildLaunchCommand } from './open-in-apps.ts';

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('buildLaunchCommand', () => {
  test('quotes Windows reveal paths that contain spaces', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const path = 'C:\\Users\\Test User\\project\\file.ts';
    expect(buildLaunchCommand('reveal', path)).toEqual(['explorer', `/select,"${path}"`]);
  });

  test('forwards line goto flags through the macOS app-bundle fallback', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    // Force the macOS .app path by clearing PATH so CLI bins are not found.
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const command = buildLaunchCommand('cursor', '/tmp/demo.ts', 42);
      // Only assert when Cursor.app is installed on this host.
      if (command?.[0] === 'open') {
        expect(command).toEqual([
          'open',
          '-a',
          command[2]!,
          '--args',
          '-g',
          '/tmp/demo.ts:42',
        ]);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
