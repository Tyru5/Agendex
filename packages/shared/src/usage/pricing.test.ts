import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelRates, lookupRate, type ModelRateTable, priceUsage } from './pricing.ts';
import type { UsageTokenTotals } from './types.ts';

const RATE = {
  inputCostPerToken: 3e-6,
  outputCostPerToken: 15e-6,
  cacheReadCostPerToken: 0.3e-6,
  cacheCreationCostPerToken: 3.75e-6,
};

function totals(overrides: Partial<UsageTokenTotals> = {}): UsageTokenTotals {
  return {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    ...overrides,
  };
}

test('priceUsage prefers provider-reported cost', () => {
  const priced = priceUsage(totals({ uncachedInputTokens: 1_000_000 }), 1.23, RATE);
  expect(priced.costUsd).toBe(1.23);
  expect(priced.priced).toBe(true);
});

test('priceUsage computes model-priced cost per disjoint category', () => {
  const priced = priceUsage(
    totals({
      uncachedInputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
    null,
    RATE,
  );
  expect(priced.costUsd).toBeCloseTo(3 + 0.3 + 3.75 + 15);
  expect(priced.cacheSavingsUsd).toBeCloseTo(2.7);
});

test('priceUsage marks unknown models unpriced with zero cost', () => {
  const priced = priceUsage(totals({ uncachedInputTokens: 1_000_000 }), null, null);
  expect(priced.costUsd).toBe(0);
  expect(priced.priced).toBe(false);
});

test('lookupRate matches exact ids, short forms, and skips ambiguous names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-usage-rates-'));
  try {
    await writeFile(
      join(dir, 'usage-model-rates.json'),
      JSON.stringify({
        fetchedAt: Date.now(),
        raw: {
          'anthropic/claude-sonnet-4-20250514': {
            input_cost_per_token: 3e-6,
            output_cost_per_token: 15e-6,
            cache_read_input_token_cost: 0.3e-6,
          },
          'gpt-5-codex': { input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5 },
        },
      }),
    );
    const table: ModelRateTable = await loadModelRates({ cacheDir: dir });

    expect(lookupRate(table, 'anthropic/claude-sonnet-4-20250514')).not.toBeNull();
    // Short-form fallback: transcript model has no vendor prefix.
    expect(lookupRate(table, 'claude-sonnet-4-20250514')).not.toBeNull();
    expect(lookupRate(table, 'GPT-5-Codex')).not.toBeNull();
    // Ambiguous family names stay unpriced instead of guessing.
    expect(lookupRate(table, 'sonnet')).toBeNull();
    expect(lookupRate(table, 'unknown-model')).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
