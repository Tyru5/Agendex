import { expect, test } from 'bun:test';
import {
  parseDesktopDaemonParentMessage,
  parseDesktopDaemonWorkerMessage,
} from './desktop-daemon-protocol.ts';

// Only authenticated lifecycle messages should cross into the bundled sync worker.
test('desktop daemon protocol accepts the closed parent message set', () => {
  expect(
    parseDesktopDaemonParentMessage({
      type: 'start',
      credentials: {
        token: 'secret',
        convexSiteUrl: 'https://example.convex.site',
        accountId: 'account-1',
      },
      parentPid: 42,
    }),
  ).toEqual({
    type: 'start',
    credentials: {
      token: 'secret',
      convexSiteUrl: 'https://example.convex.site',
      accountId: 'account-1',
    },
    parentPid: 42,
  });
  expect(parseDesktopDaemonParentMessage({ type: 'shutdown' })).toEqual({ type: 'shutdown' });
  expect(parseDesktopDaemonParentMessage({ type: 'start', parentPid: -1 })).toBeNull();
});

// Malformed worker events must not corrupt the desktop's visible sync state.
test('desktop daemon protocol rejects malformed worker messages', () => {
  expect(parseDesktopDaemonWorkerMessage({ type: 'booted', pid: 122 })).toEqual({
    type: 'booted',
    pid: 122,
  });
  expect(
    parseDesktopDaemonWorkerMessage({
      type: 'status',
      status: 'indexing',
      message: 'Scanning plan folders',
    }),
  ).toEqual({ type: 'status', status: 'indexing', message: 'Scanning plan folders' });
  expect(parseDesktopDaemonWorkerMessage({ type: 'ready', pid: 123 })).toEqual({
    type: 'ready',
    pid: 123,
  });
  expect(
    parseDesktopDaemonWorkerMessage({
      type: 'token-rotated',
      previousToken: 'old',
      token: 'new',
      accountId: 'account-1',
    }),
  ).toEqual({
    type: 'token-rotated',
    previousToken: 'old',
    token: 'new',
    accountId: 'account-1',
  });
  expect(
    parseDesktopDaemonWorkerMessage({ type: 'auth-expired', failedToken: 'expired-token' }),
  ).toEqual({ type: 'auth-expired', failedToken: 'expired-token' });
  expect(parseDesktopDaemonWorkerMessage({ type: 'auth-expired' })).toBeNull();
  expect(parseDesktopDaemonWorkerMessage({ type: 'ready', pid: 0 })).toBeNull();
  expect(parseDesktopDaemonWorkerMessage({ type: 'booted', pid: 0 })).toBeNull();
  expect(parseDesktopDaemonWorkerMessage({ type: 'status', status: 'unknown' })).toBeNull();
  expect(parseDesktopDaemonWorkerMessage({ type: 'unknown' })).toBeNull();
});
