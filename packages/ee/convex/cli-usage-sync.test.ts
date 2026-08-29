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
    agents: [
      {
        agent: 'codex-cli',
        totals: { ...emptyTotals, outputTokens: 2 },
        totalTokens: 2,
        costUsd: 1,
        records: 1,
        unpricedRecords: 0,
        sessions: 1,
      },
    ],
    buckets: [
      {
        start: '2026-08-28',
        costUsd: 1,
        totalTokens: 2,
        byAgent: { 'codex-cli': { costUsd: 1, totalTokens: 2 } },
      },
    ],
  });
  const right = summary({
    generatedAt: '2026-08-29T18:00:00.000Z',
    totals: { ...emptyTotals, outputTokens: 3 },
    totalTokens: 3,
    costUsd: 2,
    records: 2,
    sessions: 2,
    models: [],
    agents: [
      {
        agent: 'codex-cli',
        totals: { ...emptyTotals, outputTokens: 3 },
        totalTokens: 3,
        costUsd: 2,
        records: 2,
        unpricedRecords: 0,
        sessions: 2,
      },
    ],
    buckets: [
      {
        start: '2026-08-28',
        costUsd: 2,
        totalTokens: 3,
        byAgent: { 'codex-cli': { costUsd: 2, totalTokens: 3 } },
      },
    ],
  });

  expect(mergeUsageSummaries([left, right], 30)).toMatchObject({
    days: 30,
    generatedAt: '2026-08-29T18:00:00.000Z',
    costUsd: 3,
    records: 3,
    sessions: 3,
    totalTokens: 5,
    agents: [{ agent: 'codex-cli', sessions: 3, costUsd: 3, totalTokens: 5 }],
    buckets: [
      {
        start: '2026-08-28',
        costUsd: 3,
        totalTokens: 5,
        byAgent: { 'codex-cli': { costUsd: 3, totalTokens: 5 } },
      },
    ],
  });
});
