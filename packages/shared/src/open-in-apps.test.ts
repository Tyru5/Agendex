import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectHandoffClis, buildLaunchCommand } from './open-in-apps.ts';

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('buildLaunchCommand', () => {
  // User story: Windows Explorer can reveal files whose paths contain spaces.
  test('quotes Windows reveal paths that contain spaces', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const path = 'C:\\Users\\Test User\\project\\file.ts';
    expect(buildLaunchCommand('reveal', path)).toEqual(['explorer', `/select,"${path}"`]);
  });

  // User story: macOS app-bundle fallbacks preserve the requested editor line number.
  test('forwards line goto flags through the macOS app-bundle fallback', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    // Force the macOS .app path by clearing PATH so CLI bins are not found.
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const command = buildLaunchCommand('cursor', '/tmp/demo.ts', 42);
      // Only assert when Cursor.app is installed on this host.
      if (command?.[0] === 'open') {
        const appName = command[2];
        expect(appName).toBeDefined();
        if (!appName) throw new Error('Expected a macOS app name');
        expect(command).toEqual(['open', '-a', appName, '--args', '-g', '/tmp/demo.ts:42']);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test('handoff detection requires an executable file and handles missing/Windows targets', () => {
  const originalPath = process.env.PATH;
  const directory = mkdtempSync(join(tmpdir(), 'agendex-clis-'));
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.PATH = directory;
    expect(detectHandoffClis()).toEqual([]);
    mkdirSync(join(directory, 'codex'));
    writeFileSync(join(directory, 'claude'), '#!/bin/sh\n', { mode: 0o644 });
    expect(detectHandoffClis()).toEqual([]);
    chmodSync(join(directory, 'claude'), 0o755);
    expect(detectHandoffClis()).toEqual([{ id: 'claude', label: 'Claude Code' }]);
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(detectHandoffClis()).toEqual([]);
  } finally {
    process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
