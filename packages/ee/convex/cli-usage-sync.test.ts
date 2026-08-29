import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUsageSnapshots } from './cli';

const dir = dirname(fileURLToPath(import.meta.url));
const cliSource = readFileSync(join(dir, 'cli.ts'), 'utf8');
const schemaSource = readFileSync(join(dir, 'schema.ts'), 'utf8');

test('heartbeat stores sanitized usage snapshots and exposes the latest owner summary', () => {
  expect(schemaSource).toContain('usageSnapshots: v.optional(v.any())');
  expect(schemaSource).toContain('usageUpdatedAt: v.optional(v.number())');
  expect(cliSource).toContain('normalizeUsageSnapshots');
  expect(cliSource).toContain('sources: []');
  expect(cliSource).toContain('export const getUsage = query');
  expect(cliSource).toContain("withIndex('by_owner'");
  expect(cliSource).toContain('(b.usageUpdatedAt ?? 0) - (a.usageUpdatedAt ?? 0)');
});

test('usage snapshot validation strips local sources and rejects malformed windows', () => {
  const summary = {
    generatedAt: '2026-08-29T18:00:00.000Z',
    days: 30,
    resolution: 'day',
    buckets: [],
    totals: {},
    totalTokens: 1,
    costUsd: 0,
    cacheSavingsUsd: 0,
    records: 1,
    unpricedRecords: 0,
    sessions: 1,
    agents: [],
    models: [],
    sources: [{ path: '/private/transcript.jsonl' }],
    scanDurationMs: 42,
  };

  expect(normalizeUsageSnapshots({ '30': summary })).toMatchObject({
    '30': { days: 30, sources: [], scanDurationMs: 0 },
  });
  expect(normalizeUsageSnapshots({ '30': { ...summary, days: 7 } })).toBeUndefined();
  expect(
    normalizeUsageSnapshots({ '30': { ...summary, extra: 'x'.repeat(512_000) } }),
  ).toBeUndefined();
  expect(
    normalizeUsageSnapshots({ '30': { ...summary, extra: 'é'.repeat(260_000) } }),
  ).toBeUndefined();
});
