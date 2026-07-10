import { expect, test } from 'bun:test';
import {
  parseDesktopDaemonParentMessage,
  parseDesktopDaemonWorkerMessage,
} from './desktop-daemon-protocol.ts';

test('desktop daemon protocol accepts the closed parent message set', () => {
  expect(
    parseDesktopDaemonParentMessage({
      type: 'start',
      credentials: { token: 'secret', convexSiteUrl: 'https://example.convex.site' },
      parentPid: 42,
    }),
  ).toEqual({
    type: 'start',
    credentials: { token: 'secret', convexSiteUrl: 'https://example.convex.site' },
    parentPid: 42,
  });
  expect(parseDesktopDaemonParentMessage({ type: 'shutdown' })).toEqual({ type: 'shutdown' });
  expect(parseDesktopDaemonParentMessage({ type: 'start', parentPid: -1 })).toBeNull();
});

test('desktop daemon protocol rejects malformed worker messages', () => {
  expect(parseDesktopDaemonWorkerMessage({ type: 'ready', pid: 123 })).toEqual({
    type: 'ready',
    pid: 123,
  });
  expect(
    parseDesktopDaemonWorkerMessage({
      type: 'token-rotated',
      previousToken: 'old',
      token: 'new',
    }),
  ).toEqual({ type: 'token-rotated', previousToken: 'old', token: 'new' });
  expect(
    parseDesktopDaemonWorkerMessage({ type: 'auth-expired', failedToken: 'expired-token' }),
  ).toEqual({ type: 'auth-expired', failedToken: 'expired-token' });
  expect(parseDesktopDaemonWorkerMessage({ type: 'auth-expired' })).toBeNull();
  expect(parseDesktopDaemonWorkerMessage({ type: 'ready', pid: 0 })).toBeNull();
  expect(parseDesktopDaemonWorkerMessage({ type: 'unknown' })).toBeNull();
});
