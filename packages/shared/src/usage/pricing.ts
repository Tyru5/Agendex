/**
 * Model pricing for API-equivalent cost estimates.
 *
 * Rates come from LiteLLM's public model price table (the same source ccusage
 * and t3code use). The table is cached on disk for 24 hours and stale rates
 * are reused when offline. Records with no provider-reported cost and no
 * known rate stay unpriced (tokens still count; cost contributes zero).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from '../config.ts';
import type { UsageTokenTotals } from './types.ts';

const RATES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const RATES_CACHE_FILE = 'usage-model-rates.json';
const RATES_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Family-only names that would need a guess about the concrete model.
 * Guessing wrong misprices by multiples, so these stay unpriced.
 */
const AMBIGUOUS_MODELS = new Set(['opus', 'sonnet', 'haiku', 'gpt', 'grok', 'codex', 'gemini']);

export interface ModelRate {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken: number;
  cacheCreationCostPerToken: number;
}

export interface ModelRateTable {
  /** Keyed by lowercased LiteLLM model id, plus its after-slash short form. */
  rates: Map<string, ModelRate>;
  fetchedAt: number;
}

export type PricedUsage = {
  costUsd: number;
  cacheSavingsUsd: number;
  priced: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function buildRateTable(raw: Record<string, unknown>, fetchedAt: number): ModelRateTable {
  const rates = new Map<string, ModelRate>();

  const put = (key: string, rate: ModelRate) => {
    // First writer wins so exact/prefixed ids beat short-form collisions.
    if (!rates.has(key)) rates.set(key, rate);
  };

  for (const [model, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const inputCostPerToken = num(value.input_cost_per_token);
    const outputCostPerToken = num(value.output_cost_per_token);
    if (inputCostPerToken === 0 && outputCostPerToken === 0) continue;

    const rate: ModelRate = {
      inputCostPerToken,
      outputCostPerToken,
      cacheReadCostPerToken: num(value.cache_read_input_token_cost),
      cacheCreationCostPerToken:
        num(value.cache_creation_input_token_cost) || inputCostPerToken * 1.25,
    };

    const lower = model.toLowerCase();
    put(lower, rate);
    const slash = lower.lastIndexOf('/');
    if (slash !== -1) put(lower.slice(slash + 1), rate);
  }

  return { rates, fetchedAt };
}

export function lookupRate(table: ModelRateTable, model: string): ModelRate | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized || AMBIGUOUS_MODELS.has(normalized)) return null;

  const direct = table.rates.get(normalized);
  if (direct) return direct;

  const slash = normalized.lastIndexOf('/');
  if (slash !== -1) {
    const short = normalized.slice(slash + 1);
    if (!AMBIGUOUS_MODELS.has(short)) {
      const byShort = table.rates.get(short);
      if (byShort) return byShort;
    }
  }

  return null;
}

export function priceUsage(
  totals: UsageTokenTotals,
  reportedCostUsd: number | null,
  rate: ModelRate | null,
): PricedUsage {
  const cacheSavingsUsd =
    rate === null
      ? 0
      : totals.cachedInputTokens * Math.max(0, rate.inputCostPerToken - rate.cacheReadCostPerToken);

  if (reportedCostUsd !== null) {
    return { costUsd: reportedCostUsd, cacheSavingsUsd, priced: true };
  }
  if (rate === null) {
    return { costUsd: 0, cacheSavingsUsd: 0, priced: false };
  }

  const costUsd =
    totals.uncachedInputTokens * rate.inputCostPerToken +
    totals.cachedInputTokens * rate.cacheReadCostPerToken +
    totals.cacheCreationTokens * rate.cacheCreationCostPerToken +
    totals.outputTokens * rate.outputCostPerToken;

  return { costUsd, cacheSavingsUsd, priced: true };
}

// ---------------------------------------------------------------------------
// Disk cache + fetch
// ---------------------------------------------------------------------------

interface RatesCacheFile {
  fetchedAt: number;
  raw: Record<string, unknown>;
}

async function readRatesCache(path: string): Promise<RatesCacheFile | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'));
    if (!isRecord(parsed) || typeof parsed.fetchedAt !== 'number' || !isRecord(parsed.raw)) {
      return null;
    }
    return { fetchedAt: parsed.fetchedAt, raw: parsed.raw };
  } catch {
    return null;
  }
}

export async function loadModelRates(
  options: { now?: number; cacheDir?: string } = {},
): Promise<ModelRateTable> {
  const now = options.now ?? Date.now();
  const cacheDir = options.cacheDir ?? getConfigDir();
  const cachePath = join(cacheDir, RATES_CACHE_FILE);

  const cached = await readRatesCache(cachePath);
  if (cached && now - cached.fetchedAt < RATES_TTL_MS) {
    return buildRateTable(cached.raw, cached.fetchedAt);
  }

  try {
    const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`rates fetch failed: ${res.status}`);
    const raw: unknown = await res.json();
    if (!isRecord(raw)) throw new Error('rates payload is not an object');

    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify({ fetchedAt: now, raw } satisfies RatesCacheFile));
    return buildRateTable(raw, now);
  } catch {
    // Offline or fetch failure: stale rates beat no rates.
    if (cached) return buildRateTable(cached.raw, cached.fetchedAt);
    return { rates: new Map(), fetchedAt: 0 };
  }
}
