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

test('collectUsageSnapshots builds every cloud window and removes local scan details', async () => {
  const requested: number[] = [];
  const snapshots = await collectUsageSnapshots(async ({ days }) => {
    requested.push(days);
    return summary(days);
  });

  expect(requested).toEqual([...CLOUD_USAGE_WINDOWS]);
  expect(Object.keys(snapshots).sort()).toEqual(['1', '30', '7', '90']);
  for (const snapshot of Object.values(snapshots)) {
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.scanDurationMs).toBe(0);
  }
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
  );

  await expect(sync()).rejects.toThrow('scan failed');
  await sync();

  expect(loads).toBe(2);
});
