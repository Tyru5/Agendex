import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeUsageSummaries, normalizeUsageSnapshots } from './cli';

const dir = dirname(fileURLToPath(import.meta.url));
const cliSource = readFileSync(join(dir, 'cli.ts'), 'utf8');
const schemaSource = readFileSync(join(dir, 'schema.ts'), 'utf8');

const emptyTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

function summary(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-08-29T18:00:00.000Z',
    days: 30,
    resolution: 'day',
    buckets: [],
    totals: { ...emptyTotals, uncachedInputTokens: 1, outputTokens: 1 },
    totalTokens: 2,
    costUsd: 0,
    cacheSavingsUsd: 0,
    records: 1,
    unpricedRecords: 0,
    sessions: 1,
    agents: [
      {
        agent: 'codex-cli',
        totals: { ...emptyTotals, uncachedInputTokens: 1, outputTokens: 1 },
        totalTokens: 2,
        costUsd: 0,
        records: 1,
        unpricedRecords: 0,
        sessions: 1,
      },
    ],
    models: [
      {
        agent: 'codex-cli',
        model: 'gpt-5',
        totals: { ...emptyTotals, uncachedInputTokens: 1, outputTokens: 1 },
        totalTokens: 2,
        costUsd: 0,
        records: 1,
        unpricedRecords: 0,
      },
    ],
    sources: [{ path: '/private/transcript.jsonl' }],
    scanDurationMs: 42,
    ...overrides,
  };
}

test('heartbeat stores sanitized usage snapshots and exposes the latest owner summary', () => {
  expect(schemaSource).toContain('usageSnapshots: v.optional(v.any())');
  expect(schemaSource).toContain('usageUpdatedAt: v.optional(v.number())');
  expect(cliSource).toContain('normalizeUsageSnapshots');
  expect(cliSource).toContain('mergeUsageSummaries');
  expect(cliSource).toContain('sources: []');
  expect(cliSource).toContain('export const getUsage = query');
  expect(cliSource).toContain("withIndex('by_owner'");
});

test('usage snapshot validation strips local sources and rejects malformed windows', () => {
  const valid = summary();

  expect(normalizeUsageSnapshots({ '30': valid })).toMatchObject({
    '30': { days: 30, sources: [], scanDurationMs: 0 },
  });
  expect(normalizeUsageSnapshots({ '30': { ...valid, days: 7 } })).toBeUndefined();
  expect(normalizeUsageSnapshots({ '30': { ...valid, cloudFormatVersion: 3 } })).toBeUndefined();
  const legacyOversized = normalizeUsageSnapshots({
    '30': {
      ...valid,
      dedupeKeys: Array.from({ length: 8_193 }, (_, index) => `key-${index}`),
    },
  })?.['30'] as { dedupeKeys?: string[] } | undefined;
  expect(legacyOversized?.dedupeKeys).toHaveLength(8_192);
  expect(
    normalizeUsageSnapshots({
      '30': {
        ...valid,
        dedupeKeys: Array.from({ length: 20_001 }, (_, index) => `key-${index}`),
      },
    }),
  ).toBeUndefined();
  expect(
    normalizeUsageSnapshots({ '30': { ...valid, extra: 'x'.repeat(512_000) } }),
  ).toBeUndefined();
  expect(
    normalizeUsageSnapshots({ '30': { ...valid, extra: 'é'.repeat(260_000) } }),
  ).toBeUndefined();
  expect(
    normalizeUsageSnapshots({
      '30': {
        ...valid,
        agents: [{ agent: 'codex-cli', totals: emptyTotals, totalTokens: 1, costUsd: 0 }],
      },
    }),
  ).toBeUndefined();
});

test('mergeUsageSummaries combines multi-device windows', () => {
  const left = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    totals: { ...emptyTotals, outputTokens: 2 },
    totalTokens: 2,
    costUsd: 1,
    records: 1,
    sessions: 1,
    models: [],
    agents: [],
    buckets: [],
    events: [
      {
        key: 'left-a',
        agent: 'codex-cli',
        model: 'gpt-5',
        timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
        bucketStart: '2026-08-28',
        sessionId: 's-left',
        totals: { ...emptyTotals, outputTokens: 2 },
        costUsd: 1,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  });
  const right = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    totals: { ...emptyTotals, outputTokens: 3 },
    totalTokens: 3,
    costUsd: 2,
    records: 1,
    sessions: 1,
    models: [],
    agents: [],
    buckets: [],
    events: [
      {
        key: 'right-a',
        agent: 'codex-cli',
        model: 'gpt-5',
        timestampMs: Date.parse('2026-08-28T15:00:00.000Z'),
        bucketStart: '2026-08-28',
        sessionId: 's-right',
        totals: { ...emptyTotals, outputTokens: 3 },
        costUsd: 2,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  });

  expect(mergeUsageSummaries([left, right], 30)).toMatchObject({
    days: 30,
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 3,
    records: 2,
    sessions: 2,
    totalTokens: 5,
    agents: [{ agent: 'codex-cli', sessions: 2, costUsd: 3, totalTokens: 5 }],
  });
});

test('mergeUsageSummaries keeps unique events from partial device overlap', () => {
  const shared = {
    key: 'shared',
    agent: 'codex-cli',
    model: 'gpt-5',
    timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
    bucketStart: '2026-08-28',
    sessionId: 's-shared',
    totals: { ...emptyTotals, outputTokens: 1 },
    costUsd: 1,
    cacheSavingsUsd: 0,
    unpriced: false,
  };
  const primary = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    records: 2,
    events: [
      shared,
      {
        key: 'primary-only',
        agent: 'codex-cli',
        model: 'gpt-5',
        timestampMs: Date.parse('2026-08-28T13:00:00.000Z'),
        bucketStart: '2026-08-28',
        sessionId: 's-primary',
        totals: { ...emptyTotals, outputTokens: 4 },
        costUsd: 4,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  });
  const secondary = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    records: 2,
    events: [
      shared,
      {
        key: 'secondary-only',
        agent: 'claude-code',
        model: 'opus',
        timestampMs: Date.parse('2026-08-28T14:00:00.000Z'),
        bucketStart: '2026-08-28',
        sessionId: 's-secondary',
        totals: { ...emptyTotals, outputTokens: 2 },
        costUsd: 2,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  });

  expect(mergeUsageSummaries([primary, secondary], 30)).toMatchObject({
    costUsd: 7,
    records: 3,
    sessions: 3,
    totalTokens: 7,
  });
});

test('mergeUsageSummaries reconciles legacy collision events by content', () => {
  const legacyKey = 'claude-code:shared-session:1787918400000:claude-sonnet';
  const event = (inputTokens: number, ownershipKey?: string) => ({
    key: legacyKey,
    ...(ownershipKey ? { ownershipKey } : {}),
    agent: 'claude-code',
    model: 'claude-sonnet',
    timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
    bucketStart: '2026-08-28',
    sessionId: 'shared-session',
    totals: { ...emptyTotals, uncachedInputTokens: inputTokens },
    costUsd: inputTokens,
    cacheSavingsUsd: 0,
    unpriced: false,
  });
  const legacyB = summary({
    records: 1,
    events: [event(200)],
    agents: [],
    models: [],
  });
  const legacyA = summary({
    records: 1,
    events: [event(100)],
    agents: [],
    models: [],
  });
  const v2A = summary({
    cloudFormatVersion: 2,
    records: 1,
    dedupeKeys: ['fingerprint-a'],
    events: [event(100, 'fingerprint-a')],
    agents: [],
    models: [],
  });
  const v2AB = summary({
    cloudFormatVersion: 2,
    records: 2,
    dedupeKeys: ['fingerprint-a', 'fingerprint-b'],
    events: [event(100, 'fingerprint-a'), event(200, 'fingerprint-b')],
    agents: [],
    models: [],
  });
  const v2Partial = summary({
    cloudFormatVersion: 2,
    records: 2,
    totals: { ...emptyTotals, uncachedInputTokens: 300 },
    totalTokens: 300,
    costUsd: 300,
    dedupeKeys: ['fingerprint-a', 'fingerprint-b'],
    events: [event(100, 'fingerprint-a')],
    agents: [],
    models: [],
  });

  expect(mergeUsageSummaries([legacyB, v2A], 30)).toMatchObject({
    records: 2,
    totalTokens: 300,
  });
  expect(mergeUsageSummaries([legacyB, v2AB], 30)).toMatchObject({
    records: 2,
    totalTokens: 300,
  });
  expect(mergeUsageSummaries([legacyA, v2Partial], 30)).toMatchObject({
    records: 2,
    totalTokens: 300,
  });
});

test('mergeUsageSummaries uses complete keys instead of a legacy partial event prefix', () => {
  const event = (key: string) => ({
    key,
    agent: 'codex-cli',
    model: 'gpt-5',
    timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
    bucketStart: '2026-08-28',
    sessionId: `s-${key}`,
    totals: { ...emptyTotals, outputTokens: 1 },
    costUsd: 1,
    cacheSavingsUsd: 0,
    unpriced: false,
  });
  const left = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    records: 3,
    totals: { ...emptyTotals, outputTokens: 3 },
    totalTokens: 3,
    costUsd: 3,
    dedupeKeys: ['a', 'b', 'c'],
    events: [event('a')],
    agents: [],
    models: [],
  });
  const right = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    records: 2,
    totals: { ...emptyTotals, outputTokens: 2 },
    totalTokens: 2,
    costUsd: 2,
    dedupeKeys: ['d', 'e'],
    events: [event('d')],
    agents: [],
    models: [],
  });

  expect(mergeUsageSummaries([left, right], 30)).toMatchObject({
    records: 5,
    totalTokens: 5,
    costUsd: 5,
  });
});

test('mergeUsageSummaries uses the newest v2 aggregate when ownership keys are truncated', () => {
  const partial = (generatedAt: string, costUsd: number, key: string) =>
    summary({
      generatedAt,
      cloudFormatVersion: 2,
      records: 1_000,
      totals: { ...emptyTotals, outputTokens: costUsd },
      totalTokens: costUsd,
      costUsd,
      dedupeKeys: [key],
      events: [
        {
          key,
          agent: 'codex-cli',
          model: 'gpt-5',
          timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
          bucketStart: '2026-08-28',
          sessionId: `s-${key}`,
          totals: { ...emptyTotals, outputTokens: 1 },
          costUsd: 1,
          cacheSavingsUsd: 0,
          unpriced: false,
        },
      ],
      agents: [],
      models: [],
    });

  const merged = mergeUsageSummaries(
    [
      partial('2026-08-29T18:00:00.000Z', 50, 'newest'),
      partial('2026-08-29T17:00:00.000Z', 40, 'older'),
    ],
    30,
  );
  expect(merged).toMatchObject({
    generatedAt: '2026-08-29T18:00:00.000Z',
    records: 1_000,
    totalTokens: 50,
    costUsd: 50,
  });
  expect(merged).not.toHaveProperty('cloudFormatVersion');
  expect(merged).not.toHaveProperty('dedupeKeys');
  expect(merged).not.toHaveProperty('events');
});

test('mergeUsageSummaries keeps truncated v2 events when an exact peer exists', () => {
  const event = (key: string, costUsd: number) => ({
    key,
    agent: 'codex-cli',
    model: 'gpt-5',
    timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
    bucketStart: '2026-08-28',
    sessionId: `s-${key}`,
    totals: { ...emptyTotals, outputTokens: costUsd },
    costUsd,
    cacheSavingsUsd: 0,
    unpriced: false,
  });
  const truncated = summary({
    cloudFormatVersion: 2,
    records: 1_000,
    totals: { ...emptyTotals, outputTokens: 50 },
    totalTokens: 50,
    costUsd: 50,
    dedupeKeys: ['partial'],
    events: [event('partial', 1)],
    agents: [],
    models: [],
  });
  const exact = summary({
    records: 1,
    totals: { ...emptyTotals, outputTokens: 7 },
    totalTokens: 7,
    costUsd: 7,
    dedupeKeys: ['exact'],
    events: [event('exact', 7)],
    agents: [],
    models: [],
  });

  expect(mergeUsageSummaries([truncated, exact], 30)).toMatchObject({
    records: 2,
    totalTokens: 8,
    costUsd: 8,
  });
});

test('mergeUsageSummaries skips key-only devices that overlap eventful ones', () => {
  const eventful = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 3,
    records: 1,
    sessions: 1,
    dedupeKeys: ['shared', 'event-only'],
    events: [
      {
        key: 'shared',
        agent: 'codex-cli',
        model: 'gpt-5',
        timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
        bucketStart: '2026-08-28',
        sessionId: 's1',
        totals: { ...emptyTotals, outputTokens: 3 },
        costUsd: 3,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  });
  const keyOnlyOverlap = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    costUsd: 9,
    records: 9,
    sessions: 9,
    dedupeKeys: ['shared', 'other'],
    events: [],
  });

  expect(mergeUsageSummaries([eventful, keyOnlyOverlap], 30)).toMatchObject({
    costUsd: 3,
    records: 1,
    sessions: 1,
  });
});

test('mergeUsageSummaries claims key-only summaries only after accepting them', () => {
  const newest = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 2,
    totals: { ...emptyTotals, outputTokens: 2 },
    totalTokens: 2,
    dedupeKeys: ['shared'],
    events: [],
  });
  const disjoint = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    costUsd: 3,
    totals: { ...emptyTotals, outputTokens: 3 },
    totalTokens: 3,
    dedupeKeys: ['disjoint'],
    events: [],
  });
  const overlappingOlder = summary({
    generatedAt: '2026-08-29T16:00:00.000Z',
    costUsd: 99,
    records: 9,
    sessions: 9,
    totals: { ...emptyTotals, outputTokens: 99 },
    totalTokens: 99,
    dedupeKeys: ['shared', 'older-only'],
    events: [],
  });

  expect(mergeUsageSummaries([newest], 30)).toMatchObject({
    costUsd: 2,
    records: 1,
    sessions: 1,
  });
  expect(mergeUsageSummaries([disjoint, newest], 30)).toMatchObject({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 5,
    records: 2,
    sessions: 2,
    totalTokens: 5,
  });
  expect(mergeUsageSummaries([overlappingOlder, disjoint, newest], 30)).toMatchObject({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 5,
    records: 2,
    sessions: 2,
    totalTokens: 5,
  });
});

test('mergeUsageSummaries never sums aggregates without ownership keys', () => {
  const newestKeyless = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 2,
    totals: { ...emptyTotals, outputTokens: 2 },
    totalTokens: 2,
    dedupeKeys: [],
    events: [],
  });
  const olderKeyless = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    costUsd: 99,
    records: 9,
    totals: { ...emptyTotals, outputTokens: 99 },
    totalTokens: 99,
    dedupeKeys: [],
    events: [],
  });
  const owned = summary({
    generatedAt: '2026-08-29T16:00:00.000Z',
    costUsd: 3,
    totals: { ...emptyTotals, outputTokens: 3 },
    totalTokens: 3,
    dedupeKeys: ['owned'],
    events: [],
  });

  expect(mergeUsageSummaries([olderKeyless, newestKeyless], 30)).toMatchObject({
    costUsd: 2,
    records: 1,
    totalTokens: 2,
  });
  expect(mergeUsageSummaries([newestKeyless, owned], 30)).toMatchObject({
    costUsd: 3,
    records: 1,
    totalTokens: 3,
  });
});

test('mergeUsageSummaries never sums truncated ownership samples', () => {
  const newest = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 2,
    records: 2,
    totals: { ...emptyTotals, outputTokens: 2 },
    totalTokens: 2,
    dedupeKeys: ['newest-sample'],
    events: [],
  });
  const older = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    costUsd: 3,
    records: 2,
    totals: { ...emptyTotals, outputTokens: 3 },
    totalTokens: 3,
    dedupeKeys: ['older-sample'],
    events: [],
  });
  const idle = summary({
    generatedAt: '2026-08-29T19:00:00.000Z',
    costUsd: 0,
    records: 0,
    sessions: 0,
    totals: emptyTotals,
    totalTokens: 0,
    dedupeKeys: [],
    events: [],
  });

  expect(mergeUsageSummaries([older, newest], 30)).toMatchObject({
    costUsd: 2,
    records: 2,
    totalTokens: 2,
  });
  expect(mergeUsageSummaries([newest, idle], 30)).toMatchObject({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 2,
    records: 2,
    totalTokens: 2,
  });
  expect(mergeUsageSummaries([idle], 30)).toMatchObject({
    generatedAt: '2026-08-29T19:00:00.000Z',
    costUsd: 0,
    records: 0,
    totalTokens: 0,
  });
  expect(
    mergeUsageSummaries([idle, { ...idle, generatedAt: '2026-08-29T18:00:00.000Z' }], 30),
  ).toMatchObject({
    costUsd: 0,
    records: 0,
    totalTokens: 0,
  });
});

test('mergeUsageSummaries uses a capped aggregate when keys cover every record', () => {
  const capped = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 50,
    records: 2,
    sessions: 2,
    totalTokens: 50,
    totals: { ...emptyTotals, outputTokens: 50 },
    dedupeKeys: ['a', 'b'],
    // Incomplete event prefix for a larger record count.
    events: [
      {
        key: 'a',
        agent: 'codex-cli',
        model: 'gpt-5',
        timestampMs: Date.parse('2026-08-28T12:00:00.000Z'),
        bucketStart: '2026-08-28',
        sessionId: 's1',
        totals: { ...emptyTotals, outputTokens: 1 },
        costUsd: 1,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  });
  const other = summary({
    generatedAt: '2026-08-29T17:00:00.000Z',
    costUsd: 7,
    records: 1,
    sessions: 1,
    totalTokens: 7,
    totals: { ...emptyTotals, outputTokens: 7 },
    agents: [],
    models: [],
    dedupeKeys: ['z'],
    events: [
      {
        key: 'z',
        agent: 'claude-code',
        model: 'opus',
        timestampMs: Date.parse('2026-08-28T13:00:00.000Z'),
        bucketStart: '2026-08-28',
        sessionId: 's2',
        totals: { ...emptyTotals, outputTokens: 7 },
        costUsd: 7,
        cacheSavingsUsd: 0,
        unpriced: false,
      },
    ],
  });

  expect(mergeUsageSummaries([capped, other], 30)).toMatchObject({
    costUsd: 57,
    records: 3,
    sessions: 3,
  });
});
