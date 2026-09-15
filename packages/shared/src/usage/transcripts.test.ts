import { expect, test } from 'bun:test';
import {
  createCodexState,
  mightCarryUsage,
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
} from './transcripts.ts';
import { totalTokens } from './types.ts';

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

function claudeLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-01T10:00:00Z',
    sessionId: 'sess-1',
    requestId: 'req-1',
    message: {
      id: 'msg-1',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 300,
        output_tokens: 50,
      },
    },
    ...overrides,
  });
}

test('parseClaudeLine maps usage into disjoint token categories', () => {
  const record = parseClaudeLine(claudeLine(), 'fallback');
  expect(record).not.toBeNull();
  expect(record?.agent).toBe('claude-code');
  expect(record?.model).toBe('claude-sonnet-4-20250514');
  expect(record?.sessionId).toBe('sess-1');
  expect(record?.totals).toEqual({
    uncachedInputTokens: 100,
    cachedInputTokens: 2000,
    cacheCreationTokens: 300,
    outputTokens: 50,
    reasoningTokens: 0,
  });
  expect(record ? totalTokens(record.totals) : 0).toBe(2450);
  expect(record?.dedupeKey).toBe('claude:msg-1:req-1');
});

test('parseClaudeLine ignores non-assistant rows and synthetic models', () => {
  expect(parseClaudeLine(JSON.stringify({ type: 'user' }), 'f')).toBeNull();
  const synthetic = claudeLine({
    message: { id: 'm', model: '<synthetic>', usage: { input_tokens: 5 } },
  });
  expect(parseClaudeLine(synthetic, 'f')).toBeNull();
  expect(parseClaudeLine('not json', 'f')).toBeNull();
});

test('parseClaudeLine keeps provider-reported cost', () => {
  const record = parseClaudeLine(claudeLine({ costUSD: 0.42 }), 'f');
  expect(record?.reportedCostUsd).toBe(0.42);
});

test('repeated claude usage rows share a dedupe key', () => {
  const a = parseClaudeLine(claudeLine(), 'f');
  const b = parseClaudeLine(claudeLine(), 'f');
  expect(a?.dedupeKey).toBe(b?.dedupeKey ?? '');
});

// ---------------------------------------------------------------------------
// Codex CLI
// ---------------------------------------------------------------------------

test('parseCodexLine tracks session and model, subtracts cached input', () => {
  const state = createCodexState('fallback');

  expect(
    parseCodexLine(JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1' } }), state),
  ).toBeNull();
  expect(
    parseCodexLine(
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5-codex' } }),
      state,
    ),
  ).toBeNull();

  const record = parseCodexLine(
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-01T10:00:00Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 700,
            output_tokens: 200,
            reasoning_output_tokens: 80,
          },
        },
      },
    }),
    state,
  );

  expect(record?.agent).toBe('codex-cli');
  expect(record?.model).toBe('gpt-5-codex');
  expect(record?.sessionId).toBe('thread-1');
  expect(record?.totals.uncachedInputTokens).toBe(300);
  expect(record?.totals.cachedInputTokens).toBe(700);
  expect(record?.totals.outputTokens).toBe(200);
  expect(record?.totals.reasoningTokens).toBe(80);
});

test('parseCodexLine drops identical consecutive token payloads', () => {
  const state = createCodexState('fallback');
  const line = JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-08-01T10:00:00Z',
    payload: {
      type: 'token_count',
      info: { last_token_usage: { input_tokens: 10, output_tokens: 5 } },
    },
  });
  expect(parseCodexLine(line, state)).not.toBeNull();
  expect(parseCodexLine(line, state)).toBeNull();
});

// ---------------------------------------------------------------------------
// Grok Build
// ---------------------------------------------------------------------------

test('parseGrokLine converts cost ticks and handles nested update envelope', () => {
  const records = parseGrokLine(
    JSON.stringify({
      timestamp: '2026-08-01T10:00:00Z',
      update: {
        type: 'turn_completed',
        usage: {
          inputTokens: 500,
          cachedReadTokens: 200,
          outputTokens: 100,
          reasoningTokens: 40,
          costUsdTicks: 25_000_000_000,
        },
      },
    }),
    'grok:session-x',
  );

  expect(records).toHaveLength(1);
  const [record] = records;
  expect(record?.agent).toBe('grok');
  expect(record?.totals.uncachedInputTokens).toBe(300);
  expect(record?.reportedCostUsd).toBeCloseTo(2.5);
  expect(record?.sessionId).toBe('grok:session-x');
  expect(record?.preserveLegacyCloudKey).toBe(true);
});

test('parseGrokLine accepts native ACP sessionUpdate envelope', () => {
  const records = parseGrokLine(
    JSON.stringify({
      timestamp: 1_788_860_667,
      method: '_x.ai/session/update',
      params: {
        sessionId: '01a044cb-native',
        update: {
          sessionUpdate: 'turn_completed',
          usage: {
            inputTokens: 500,
            cachedReadTokens: 200,
            outputTokens: 100,
            reasoningTokens: 40,
            costUsdTicks: 25_000_000_000,
            modelUsage: {
              'grok-4.6-build': {
                inputTokens: 500,
                cachedReadTokens: 200,
                outputTokens: 100,
                reasoningTokens: 40,
                costUsdTicks: 25_000_000_000,
              },
            },
          },
        },
      },
    }),
    'fallback',
  );

  expect(records).toHaveLength(1);
  const [record] = records;
  expect(record?.agent).toBe('grok');
  expect(record?.model).toBe('grok-4.6-build');
  expect(record?.sessionId).toBe('01a044cb-native');
  expect(record?.totals.uncachedInputTokens).toBe(300);
  expect(record?.reportedCostUsd).toBeCloseTo(2.5);
  expect(record?.timestampMs).toBe(1_788_860_667_000);
});

test('parseGrokLine allocates remaining cost across unticked models by tokens', () => {
  const records = parseGrokLine(
    JSON.stringify({
      type: 'turn_completed',
      timestamp: '2026-08-01T10:00:00Z',
      usage: {
        costUsdTicks: 40_000_000_000, // $4 total
        modelUsage: {
          'grok-4-fast': {
            inputTokens: 100,
            outputTokens: 100,
            costUsdTicks: 10_000_000_000, // $1 explicit
          },
          'grok-4': { inputTokens: 600, outputTokens: 0 },
          'grok-3-mini': { inputTokens: 300, outputTokens: 0 },
        },
      },
    }),
    'fallback',
  );

  expect(records).toHaveLength(3);
  const byModel = new Map(records.map((r) => [r.model, r.reportedCostUsd]));
  expect(byModel.get('grok-4-fast')).toBeCloseTo(1);
  expect(byModel.get('grok-4')).toBeCloseTo(2); // 600/900 of remaining $3
  expect(byModel.get('grok-3-mini')).toBeCloseTo(1); // 300/900 of remaining $3
});

test('parseGrokLine creates bounded stable keys without a timestamp or session id', () => {
  const line = JSON.stringify({
    update: {
      type: 'turn_completed',
      usage: { inputTokens: 2, outputTokens: 1 },
    },
  });

  const firstRecord = parseGrokLine(line, 'grok:session-a', '1')[0];
  const first = firstRecord?.dedupeKey;
  const repeated = parseGrokLine(line, 'grok:session-a', '1')[0]?.dedupeKey;
  const otherSession = parseGrokLine(line, 'grok:session-b', '1')[0]?.dedupeKey;
  const otherOccurrence = parseGrokLine(line, 'grok:session-a', '2')[0]?.dedupeKey;

  expect(first).toBe(repeated);
  expect(first).not.toBe(otherSession);
  expect(first).not.toBe(otherOccurrence);
  expect(first?.length).toBeLessThanOrEqual(256);
  expect(firstRecord?.preserveLegacyCloudKey).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Prefilter
// ---------------------------------------------------------------------------

test('mightCarryUsage never drops lines its parser would accept', () => {
  expect(mightCarryUsage('claude-code', claudeLine())).toBe(true);
  expect(mightCarryUsage('claude-code', '{"type":"user"}')).toBe(false);
  expect(mightCarryUsage('codex-cli', '{"payload":{"type":"token_count"}}')).toBe(true);
  expect(mightCarryUsage('grok', '{"update":{"type":"turn_completed"}}')).toBe(true);
  expect(mightCarryUsage('grok', '{"params":{"update":{"sessionUpdate":"turn_completed"}}}')).toBe(
    true,
  );
});
