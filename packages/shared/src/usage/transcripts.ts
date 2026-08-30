/**
 * Provider transcript line parsers. Each parser normalizes native session
 * history (written by the CLIs themselves, including activity outside
 * Agendex) into `UsageRecord`s. Modeled on t3code/ccusage semantics:
 *
 * - Claude Code repeats the same usage object once per assistant content
 *   block, so records are deduplicated by `message.id` + `requestId`.
 * - Codex `token_count` events do not carry the model; a stateful reducer
 *   tracks the current model from `turn_context` lines. Codex
 *   `input_tokens` INCLUDES cached and cache-write tokens, which are
 *   subtracted to get uncached input. Forked rollout files copy parent
 *   history verbatim, so records also carry a content-derived dedupe key.
 * - Grok Build reports usage on `turn_completed` updates with integer cost
 *   ticks (1 USD = 1e10 ticks) and an optional per-model breakdown.
 */
import { createHash } from 'node:crypto';
import type { UsageAgent, UsageRecord, UsageTokenTotals } from './types.ts';

const GROK_TICKS_PER_USD = 10_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Clamp to a non-negative integer; anything malformed becomes 0. */
function int(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: values before ~2001 in ms are actually seconds.
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Cheap substring prefilter so most transcript lines skip JSON.parse.
 * A false positive is fine; a false negative would drop usage.
 */
export function mightCarryUsage(agent: UsageAgent, line: string): boolean {
  if (agent === 'claude-code') return line.includes('"usage"');
  if (agent === 'grok') return line.includes('turn_completed');
  // Codex needs session_meta/turn_context lines to feed the stateful reducer.
  return (
    line.includes('token_count') || line.includes('session_meta') || line.includes('turn_context')
  );
}

function tryParseJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude Code (~/.claude/projects/**/*.jsonl)
// ---------------------------------------------------------------------------

export function parseClaudeLine(line: string, fallbackSessionId: string): UsageRecord | null {
  const row = tryParseJson(line);
  if (!row || row.type !== 'assistant') return null;

  const message = isRecord(row.message) ? row.message : undefined;
  const usage = message && isRecord(message.usage) ? message.usage : undefined;
  if (!usage) return null;

  const model = asString(message?.model);
  if (!model || model === '<synthetic>') return null;

  const timestampMs = parseTimestampMs(row.timestamp);
  if (timestampMs === undefined) return null;

  const messageId = asString(message?.id);
  const requestId = asString(row.requestId);
  const dedupeKey =
    messageId === undefined && requestId === undefined
      ? null
      : `claude:${messageId ?? ''}:${requestId ?? ''}`;

  return {
    agent: 'claude-code',
    timestampMs,
    model,
    sessionId: asString(row.sessionId) ?? fallbackSessionId,
    totals: {
      uncachedInputTokens: int(usage.input_tokens),
      cachedInputTokens: int(usage.cache_read_input_tokens),
      cacheCreationTokens: int(usage.cache_creation_input_tokens),
      outputTokens: int(usage.output_tokens),
      reasoningTokens: 0,
    },
    reportedCostUsd: typeof row.costUSD === 'number' && row.costUSD >= 0 ? row.costUSD : null,
    dedupeKey,
  };
}

// ---------------------------------------------------------------------------
// Codex CLI (~/.codex/sessions/**/*.jsonl) — stateful per-file reducer
// ---------------------------------------------------------------------------

export interface CodexParserState {
  sessionId: string;
  model: string | null;
  lastUsageSignature: string | null;
}

export function createCodexState(fallbackSessionId: string): CodexParserState {
  return { sessionId: fallbackSessionId, model: null, lastUsageSignature: null };
}

export function parseCodexLine(line: string, state: CodexParserState): UsageRecord | null {
  const row = tryParseJson(line);
  if (!row) return null;

  const payload = isRecord(row.payload) ? row.payload : undefined;

  if (row.type === 'session_meta' && payload) {
    const id = asString(payload.id);
    if (id) state.sessionId = id;
    const model = asString(payload.model);
    if (model) state.model = model;
    return null;
  }

  if (row.type === 'turn_context' && payload) {
    const model = asString(payload.model);
    if (model) state.model = model;
    return null;
  }

  if (row.type !== 'event_msg' || !payload || payload.type !== 'token_count') return null;

  const info = isRecord(payload.info) ? payload.info : undefined;
  const last = info && isRecord(info.last_token_usage) ? info.last_token_usage : undefined;
  if (!last) return null;

  const timestampMs = parseTimestampMs(row.timestamp);
  if (timestampMs === undefined) return null;

  const inputTokens = int(last.input_tokens);
  const cachedInputTokens = int(last.cached_input_tokens);
  const cacheCreationTokens = int(last.cache_write_input_tokens);
  const outputTokens = int(last.output_tokens);
  const reasoningTokens = Math.min(outputTokens, int(last.reasoning_output_tokens));

  const totals: UsageTokenTotals = {
    // Codex input_tokens includes cached and cache-write tokens.
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
  };

  const signature = `${inputTokens}:${cachedInputTokens}:${cacheCreationTokens}:${outputTokens}:${reasoningTokens}`;
  // Codex occasionally re-emits the identical last_token_usage payload.
  if (signature === state.lastUsageSignature) return null;
  state.lastUsageSignature = signature;

  if (inputTokens === 0 && outputTokens === 0) return null;

  return {
    agent: 'codex-cli',
    timestampMs,
    model: state.model ?? 'codex',
    sessionId: state.sessionId,
    totals,
    reportedCostUsd: null,
    // Forked rollout files begin with a verbatim copy of parent history, so
    // an identical (session, timestamp, payload) tuple counts once globally.
    dedupeKey: `codex:${state.sessionId}:${timestampMs}:${signature}`,
  };
}

// ---------------------------------------------------------------------------
// Grok Build (~/.grok/sessions/**/updates.jsonl)
// ---------------------------------------------------------------------------

function grokTicksToUsd(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value / GROK_TICKS_PER_USD;
}

interface GrokModelUsage {
  model: string;
  totals: UsageTokenTotals;
  rawTokens: number;
  costUsd: number | null;
}

function grokTotals(usage: Record<string, unknown>): UsageTokenTotals {
  const inputTokens = int(usage.inputTokens);
  const cachedInputTokens = int(usage.cachedReadTokens);
  const cacheCreationTokens = int(usage.cacheCreationTokens);
  const outputTokens = int(usage.outputTokens);
  return {
    // Grok inputTokens includes cached input, like Codex.
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, int(usage.reasoningTokens)),
  };
}

function isGrokTurnCompleted(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  // Older fixtures used `type`; native Grok Build ACP uses `sessionUpdate`.
  return value.type === 'turn_completed' || value.sessionUpdate === 'turn_completed';
}

function grokDedupeKey(
  line: string,
  model: string,
  sessionId: string,
  sourcePosition: string,
): string {
  return `grok:${createHash('sha256')
    .update(line)
    .update('\0')
    .update(model)
    .update('\0')
    .update(sessionId)
    .update('\0')
    .update(sourcePosition)
    .digest('hex')}`;
}

export function parseGrokLine(
  line: string,
  fallbackSessionId: string,
  sourcePosition = '',
): UsageRecord[] {
  const row = tryParseJson(line);
  if (!row) return [];

  // Envelope varies across versions:
  // - flat: `{ type: 'turn_completed', usage }`
  // - nested: `{ update: { type: 'turn_completed', usage } }`
  // - native ACP: `{ params: { sessionId, update: { sessionUpdate: 'turn_completed', usage } } }`
  const params = isRecord(row.params) ? row.params : undefined;
  const update = isGrokTurnCompleted(row)
    ? row
    : isGrokTurnCompleted(row.update)
      ? row.update
      : params && isGrokTurnCompleted(params.update)
        ? params.update
        : null;
  if (!update) return [];

  const usage = isRecord(update.usage) ? update.usage : undefined;
  if (!usage) return [];

  const explicitTimestampMs = parseTimestampMs(update.timestamp) ?? parseTimestampMs(row.timestamp);
  const timestampMs = explicitTimestampMs ?? Date.now();
  const sessionId =
    asString(update.sessionId) ??
    asString(row.sessionId) ??
    (params ? asString(params.sessionId) : undefined) ??
    fallbackSessionId;
  const turnCostUsd = grokTicksToUsd(usage.costUsdTicks);

  const modelUsage = isRecord(usage.modelUsage) ? usage.modelUsage : undefined;
  const perModel: GrokModelUsage[] = [];
  if (modelUsage) {
    for (const [model, value] of Object.entries(modelUsage)) {
      if (!isRecord(value)) continue;
      const totals = grokTotals(value);
      perModel.push({
        model,
        totals,
        rawTokens: int(value.inputTokens) + int(value.outputTokens),
        costUsd: grokTicksToUsd(value.costUsdTicks),
      });
    }
  }

  if (perModel.length === 0) {
    const totals = grokTotals(usage);
    const model = asString(update.model) ?? 'grok';
    return [
      {
        agent: 'grok',
        timestampMs,
        model,
        sessionId,
        totals,
        reportedCostUsd: turnCostUsd,
        dedupeKey: grokDedupeKey(line, model, sessionId, sourcePosition),
        ...(explicitTimestampMs === undefined ? {} : { preserveLegacyCloudKey: true }),
      },
    ];
  }

  // Models with explicit ticks keep them; remaining turn-level cost is
  // allocated across unticked models in proportion to their token counts.
  const tickedCost = perModel.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
  const untickedTokens = perModel
    .filter((m) => m.costUsd === null)
    .reduce((sum, m) => sum + m.rawTokens, 0);
  const remainingCost = turnCostUsd === null ? null : Math.max(0, turnCostUsd - tickedCost);

  return perModel.map((m) => {
    let costUsd = m.costUsd;
    if (costUsd === null && remainingCost !== null && untickedTokens > 0) {
      costUsd = remainingCost * (m.rawTokens / untickedTokens);
    }
    return {
      agent: 'grok' as const,
      timestampMs,
      model: m.model,
      sessionId,
      totals: m.totals,
      reportedCostUsd: costUsd,
      dedupeKey: grokDedupeKey(line, m.model, sessionId, sourcePosition),
      ...(explicitTimestampMs === undefined ? {} : { preserveLegacyCloudKey: true }),
    };
  });
}
