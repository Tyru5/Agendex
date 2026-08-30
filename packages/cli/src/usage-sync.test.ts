import { expect, test } from 'bun:test';
import type { UsageSummary } from '@agendex/shared';
import { CLOUD_USAGE_WINDOWS, collectUsageSnapshots, createUsageSync } from './usage-sync.ts';

function summary(days: number): UsageSummary {
  return {
    generatedAt: '2026-08-29T18:00:00.000Z',
    days,
    resolution: days === 1 ? 'hour' : 'day',
    buckets: [],
    totals: {
      uncachedInputTokens: 10,
      cachedInputTokens: 20,
      cacheCreationTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
    },
    totalTokens: 35,
    costUsd: 0.01,
    cacheSavingsUsd: 0.02,
    records: 1,
    unpricedRecords: 0,
    sessions: 1,
    agents: [],
    models: [],
    sources: [
      {
        agent: 'codex-cli',
        path: '/Users/example/.codex/sessions',
        status: 'scanned',
        files: 1,
      },
    ],
    scanDurationMs: 42,
  };
}

test('collectUsageSnapshots builds every cloud window from one multi-window load', async () => {
  const requested: number[][] = [];
  const snapshots = await collectUsageSnapshots(async (windows) => {
    requested.push([...windows]);
    return Object.fromEntries(windows.map((days) => [String(days), summary(days)]));
  });

  expect(requested).toEqual([[...CLOUD_USAGE_WINDOWS]]);
  expect(Object.keys(snapshots).sort()).toEqual(['1', '30', '7', '90']);
  for (const snapshot of Object.values(snapshots)) {
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.scanDurationMs).toBe(0);
  }
});

test('retains partial event lists for independently deployed older backends', async () => {
  const events = Array.from({ length: 400 }, (_, index) => ({
    key: `event-${index}`,
    agent: 'codex-cli' as const,
    model: 'gpt-5',
    timestampMs: Date.parse('2026-08-29T18:00:00.000Z') + index,
    bucketStart: '2026-08-29',
    sessionId: `session-${index}`,
    totals: summary(30).totals,
    costUsd: 0.01,
    cacheSavingsUsd: 0,
    unpriced: false,
  }));
  const dedupeKeys = [...events.map((event) => event.key), 'event-400'];

  const snapshots = await collectUsageSnapshots(async () => ({
    '30': {
      ...summary(30),
      records: dedupeKeys.length,
      dedupeKeys,
      events,
    },
  }));

  expect(snapshots['30']?.events).toEqual(events);
  expect(snapshots['30']?.dedupeKeys).toEqual([...dedupeKeys].sort());
  expect(snapshots['30']?.cloudFormatVersion).toBe(2);
});

test('fits dense merge metadata under the cloud heartbeat byte budget', async () => {
  const dedupeKeys = Array.from(
    { length: 20_000 },
    (_, index) => `key-${index.toString().padStart(5, '0')}-${'a'.repeat(48)}`,
  );
  const events = Array.from({ length: 400 }, (_, index) => ({
    key: dedupeKeys[index] ?? `event-${index}`,
    agent: 'codex-cli' as const,
    model: `gpt-5-codex-${'x'.repeat(32)}`,
    timestampMs: Date.parse('2026-08-29T18:00:00.000Z') + index,
    bucketStart: '2026-08-29',
    sessionId: `session-${index}-${'y'.repeat(24)}`,
    totals: summary(30).totals,
    costUsd: 0.01,
    cacheSavingsUsd: 0,
    unpriced: false,
  }));

  const snapshots = await collectUsageSnapshots(async (windows) =>
    Object.fromEntries(
      windows.map((days) => [
        String(days),
        { ...summary(days), records: events.length, dedupeKeys, events },
      ]),
    ),
  );

  expect(Buffer.byteLength(JSON.stringify(snapshots))).toBeLessThanOrEqual(450_000);
  for (const snapshot of Object.values(snapshots)) {
    expect(snapshot.events).toBeUndefined();
    expect(snapshot.dedupeKeys).toHaveLength(1_000);
  }
});

test('retains dedupe keys beyond 1,000 when the payload already fits', async () => {
  const dedupeKeys = Array.from({ length: 1_500 }, (_, index) => `key-${index}`);
  const snapshots = await collectUsageSnapshots(async () => ({
    '30': { ...summary(30), dedupeKeys },
  }));

  expect(Buffer.byteLength(JSON.stringify(snapshots))).toBeLessThanOrEqual(450_000);
  expect(snapshots['30']?.dedupeKeys).toEqual([...dedupeKeys].sort());
});

test('caps ownership keys at the Convex array limit', async () => {
  const dedupeKeys = Array.from({ length: 8_193 }, (_, index) => `key-${index}`);
  const snapshots = await collectUsageSnapshots(async () => ({
    '30': { ...summary(30), records: dedupeKeys.length, dedupeKeys },
  }));

  expect(snapshots['30']?.dedupeKeys).toHaveLength(8_192);
  expect(Buffer.byteLength(JSON.stringify(snapshots))).toBeLessThanOrEqual(450_000);
});

test('selects the same bounded dedupe sample regardless of scanner order', async () => {
  const dedupeKeys = Array.from(
    { length: 1_000 },
    (_, index) => `key-${index.toString().padStart(4, '0')}-${'a'.repeat(600)}`,
  );
  const collect = (keys: string[]) =>
    collectUsageSnapshots(async () => ({
      '30': { ...summary(30), dedupeKeys: keys },
    }));

  const forward = await collect(dedupeKeys);
  const reversed = await collect([...dedupeKeys].reverse());

  expect(forward['30']?.dedupeKeys).toHaveLength(500);
  expect(reversed['30']?.dedupeKeys).toEqual(forward['30']?.dedupeKeys);
});

test('retains an exact event list when the snapshot fits the cloud budget', async () => {
  const event = {
    key: 'event-1',
    agent: 'codex-cli' as const,
    model: 'gpt-5',
    timestampMs: Date.parse('2026-08-29T18:00:00.000Z'),
    bucketStart: '2026-08-29',
    sessionId: 'session-1',
    totals: summary(1).totals,
    costUsd: 0.01,
    cacheSavingsUsd: 0,
    unpriced: false,
  };

  const snapshots = await collectUsageSnapshots(async () => ({
    '1': { ...summary(1), events: [event] },
  }));

  expect(snapshots['1']?.events).toEqual([event]);
});

test('omits cloud windows that were not returned by the usage scanner', async () => {
  const snapshots = await collectUsageSnapshots(async () => ({
    '30': summary(30),
  }));

  expect(Object.keys(snapshots)).toEqual(['30']);
});

test('retains the most dedupe metadata that fits each cloud budget step', async () => {
  const cases = [
    { keyBytes: 180, expectedKeys: 500 },
    { keyBytes: 380, expectedKeys: 250 },
    { keyBytes: 600, expectedKeys: 100 },
  ];

  for (const { keyBytes, expectedKeys } of cases) {
    const dedupeKeys = Array.from(
      { length: 1_000 },
      (_, index) => `key-${index.toString().padStart(4, '0')}-${'a'.repeat(keyBytes)}`,
    );
    const snapshots = await collectUsageSnapshots(async (windows) =>
      Object.fromEntries(windows.map((days) => [String(days), { ...summary(days), dedupeKeys }])),
    );

    expect(Buffer.byteLength(JSON.stringify(snapshots))).toBeLessThanOrEqual(450_000);
    for (const snapshot of Object.values(snapshots)) {
      expect(snapshot.dedupeKeys).toHaveLength(expectedKeys);
    }
  }
});

test('drops redundant keys before exact events when fitting the payload', async () => {
  const dedupeKeys = Array.from(
    { length: 20_000 },
    (_, index) => `key-${index.toString().padStart(5, '0')}-${'a'.repeat(48)}`,
  );
  const event = {
    key: 'event-1',
    agent: 'codex-cli' as const,
    model: 'gpt-5',
    timestampMs: Date.parse('2026-08-29T18:00:00.000Z'),
    bucketStart: '2026-08-29',
    sessionId: 'session-1',
    totals: summary(30).totals,
    costUsd: 0,
    cacheSavingsUsd: 0,
    unpriced: false,
  };
  const snapshots = await collectUsageSnapshots(async (windows) =>
    Object.fromEntries(
      windows.map((days) => [String(days), { ...summary(days), dedupeKeys, events: [event] }]),
    ),
  );

  for (const snapshot of Object.values(snapshots)) {
    expect(snapshot.events).toEqual([event]);
    expect(snapshot.dedupeKeys).toBeUndefined();
  }
});

test('reduces key-only windows before dropping exact events', async () => {
  const events = Array.from({ length: 100 }, (_, index) => ({
    key: `event-${index.toString().padStart(3, '0')}`,
    agent: 'codex-cli' as const,
    model: 'gpt-5',
    timestampMs: Date.parse('2026-08-29T18:00:00.000Z') + index,
    bucketStart: '2026-08-29',
    sessionId: `session-${index}`,
    totals: summary(1).totals,
    costUsd: 0,
    cacheSavingsUsd: 0,
    unpriced: false,
  }));
  const longWindowKeys = Array.from(
    { length: 10_000 },
    (_, index) => `key-${index.toString().padStart(5, '0')}-${'a'.repeat(60)}`,
  );

  const snapshots = await collectUsageSnapshots(async () => ({
    '1': {
      ...summary(1),
      records: events.length,
      dedupeKeys: events.map((event) => event.key),
      events,
    },
    '90': {
      ...summary(90),
      records: longWindowKeys.length,
      dedupeKeys: longWindowKeys,
    },
  }));

  expect(snapshots['1']?.events).toEqual(events);
  expect(snapshots['1']?.dedupeKeys).toBeUndefined();
  expect(snapshots['90']?.dedupeKeys?.length).toBeGreaterThan(0);
  expect(snapshots['90']?.dedupeKeys?.length).toBeLessThan(longWindowKeys.length);
  expect(Buffer.byteLength(JSON.stringify(snapshots))).toBeLessThanOrEqual(450_000);
});

test('rejects instead of sending aggregates without ownership keys', async () => {
  const dedupeKeys = Array.from(
    { length: 1_000 },
    (_, index) => `key-${index.toString().padStart(4, '0')}-${'a'.repeat(1_200)}`,
  );

  await expect(
    collectUsageSnapshots(async (windows) =>
      Object.fromEntries(windows.map((days) => [String(days), { ...summary(days), dedupeKeys }])),
    ),
  ).rejects.toThrow('Usage summaries exceed the cloud heartbeat byte budget');
});

test('rejects usage summaries whose required fields exceed the cloud budget', async () => {
  await expect(
    collectUsageSnapshots(async (windows) =>
      Object.fromEntries(
        windows.map((days) => [
          String(days),
          { ...summary(days), generatedAt: 'x'.repeat(150_000) },
        ]),
      ),
    ),
  ).rejects.toThrow('Usage summaries exceed the cloud heartbeat byte budget');
});

test('usage sync coalesces overlapping runs and permits a later run', async () => {
  let resolveFirst!: (snapshots: Record<string, UsageSummary>) => void;
  const firstSnapshots = new Promise<Record<string, UsageSummary>>((resolve) => {
    resolveFirst = resolve;
  });
  let loads = 0;
  const sent: Array<{ ipAddress?: string; windows: string[] }> = [];
  const sync = createUsageSync(
    async () => {
      loads += 1;
      if (loads === 1) return firstSnapshots;
      return { '30': summary(30) };
    },
    async (ipAddress, snapshots) => {
      sent.push({ ipAddress, windows: Object.keys(snapshots ?? {}) });
    },
    () => true,
  );

  const first = sync('127.0.0.1');
  const overlapping = sync('ignored-while-running');
  expect(overlapping).toBe(first);
  expect(loads).toBe(1);

  resolveFirst({ '30': summary(30) });
  await first;
  await sync('127.0.0.2');

  expect(loads).toBe(2);
  expect(sent).toEqual([
    { ipAddress: '127.0.0.1', windows: ['30'] },
    { ipAddress: '127.0.0.2', windows: ['30'] },
  ]);
});

test('usage sync clears its in-flight guard after a failed run', async () => {
  let loads = 0;
  const sync = createUsageSync(
    async () => {
      loads += 1;
      if (loads === 1) throw new Error('scan failed');
      return { '30': summary(30) };
    },
    async () => {},
    () => true,
  );

  await expect(sync()).rejects.toThrow('scan failed');
  await sync();

  expect(loads).toBe(2);
});

test('usage sync propagates heartbeat rejection and permits a retry', async () => {
  let sends = 0;
  const sync = createUsageSync(
    async () => ({ '30': summary(30) }),
    async () => {
      sends += 1;
      if (sends === 1) throw new Error('heartbeat rejected');
    },
    () => true,
  );

  await expect(sync()).rejects.toThrow('heartbeat rejected');
  await sync();

  expect(sends).toBe(2);
});

test('usage sync skips snapshot collection without cloud credentials', async () => {
  let loads = 0;
  let sends = 0;
  const sync = createUsageSync(
    async () => {
      loads += 1;
      return { '30': summary(30) };
    },
    async () => {
      sends += 1;
    },
    () => false,
  );

  await sync();

  expect(loads).toBe(0);
  expect(sends).toBe(0);
});
