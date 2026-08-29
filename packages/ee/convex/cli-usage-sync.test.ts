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
  expect(normalizeUsageSnapshots({ '30': { ...valid, extra: 'x'.repeat(512_000) } })).toBeUndefined();
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

test('mergeUsageSummaries keeps full aggregate when events are capped', () => {
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
    costUsd: 8,
    records: 2,
    sessions: 2,
  });
});
