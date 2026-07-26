import { expect, test } from 'bun:test';
import { stopDesktopServices } from './desktop-shutdown.ts';

test('destroys the renderer before waiting for local server shutdown', async () => {
  const events: string[] = [];

  await stopDesktopServices({
    window: {
      isDestroyed: () => false,
      destroy: () => events.push('window-destroyed'),
    },
    stopDaemon: async () => {
      events.push('daemon-stopped');
    },
    closeServer: async () => {
      events.push('server-close-started');
    },
  });

  expect(events[0]).toBe('window-destroyed');
  expect(events.includes('daemon-stopped')).toBe(true);
  expect(events.includes('server-close-started')).toBe(true);
});

test('does not hang when local server shutdown never settles', async () => {
  const startedAt = Date.now();

  await stopDesktopServices({
    window: null,
    stopDaemon: async () => undefined,
    closeServer: () => new Promise(() => {}),
    serverCloseTimeoutMs: 10,
  });

  expect(Date.now() - startedAt < 500).toBe(true);
});

test('does not prevent app quit when daemon shutdown never settles', async () => {
  const startedAt = Date.now();

  await stopDesktopServices({
    window: null,
    stopDaemon: () => new Promise(() => {}),
    daemonStopTimeoutMs: 10,
  });

  expect(Date.now() - startedAt < 500).toBe(true);
});
