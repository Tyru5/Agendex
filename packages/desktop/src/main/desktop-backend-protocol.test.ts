import { expect, test } from 'bun:test';
import {
  parseDesktopBackendParentMessage,
  parseDesktopBackendWorkerMessage,
} from './desktop-backend-protocol.ts';

// The local API worker should accept only the lifecycle commands Electron owns.
test('desktop backend protocol accepts lifecycle messages', () => {
  expect(
    parseDesktopBackendParentMessage({
      type: 'start',
      port: 0,
      hostname: 'localhost',
      clientDistDir: 'C:\\Agendex\\client',
      parentPid: 42,
    }),
  ).toEqual({
    type: 'start',
    port: 0,
    hostname: 'localhost',
    clientDistDir: 'C:\\Agendex\\client',
    parentPid: 42,
  });
  expect(
    parseDesktopBackendParentMessage({
      type: 'set-client-dist-dir',
      clientDistDir: 'C:\\Agendex\\updated-client',
    }),
  ).toEqual({ type: 'set-client-dist-dir', clientDistDir: 'C:\\Agendex\\updated-client' });
  expect(parseDesktopBackendParentMessage({ type: 'shutdown' })).toEqual({ type: 'shutdown' });
  expect(parseDesktopBackendParentMessage({ type: 'start', port: -1 })).toBeNull();
});

// Invalid worker events must not create a stale renderer connection.
test('desktop backend protocol validates worker messages', () => {
  expect(
    parseDesktopBackendWorkerMessage({ type: 'listening', port: 49_000, token: 'local-token' }),
  ).toEqual({ type: 'listening', port: 49_000, token: 'local-token' });
  expect(parseDesktopBackendWorkerMessage({ type: 'index-ready' })).toEqual({
    type: 'index-ready',
  });
  expect(
    parseDesktopBackendWorkerMessage({
      type: 'fatal',
      phase: 'indexing',
      message: 'scan failed',
    }),
  ).toEqual({ type: 'fatal', phase: 'indexing', message: 'scan failed' });
  expect(parseDesktopBackendWorkerMessage({ type: 'listening', port: 0, token: 'x' })).toBeNull();
  expect(
    parseDesktopBackendWorkerMessage({ type: 'fatal', phase: 'unknown', message: 'x' }),
  ).toBeNull();
});
