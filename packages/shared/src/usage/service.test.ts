import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUsageSummary } from './service.ts';
import { parseGrokLine } from './transcripts.ts';
import type { UsageSummary } from './types.ts';

function claudeRow(options: {
  messageId: string;
  requestId?: string;
  timestamp: string;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: options.timestamp,
    sessionId: options.sessionId ?? 'sess-1',
    requestId: options.requestId ?? 'req-1',
    message: {
      id: options.messageId,
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: options.inputTokens ?? 100,
        output_tokens: options.outputTokens ?? 50,
      },
    },
  });
}

async function withTempDirs(
  run: (dirs: { source: string; cache: string }) => Promise<void>,
): Promise<void> {
  const source = await mkdtemp(join(tmpdir(), 'agendex-usage-src-'));
  const cache = await mkdtemp(join(tmpdir(), 'agendex-usage-cache-'));
  // A pre-seeded fresh (empty) rate table keeps the test offline.
  await writeFile(
    join(cache, 'usage-model-rates.json'),
    JSON.stringify({ fetchedAt: Date.now(), raw: {} }),
  );
  try {
    await run({ source, cache });
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
}

test('getUsageSummary aggregates, dedupes, and windows claude transcripts', async () => {
  await withTempDirs(async ({ source, cache }) => {
    const now = new Date();
    const recent = now.toISOString();
    const old = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const projectDir = join(source, 'projects', 'my-repo');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, 'a.jsonl'),
      [
        claudeRow({ messageId: 'm1', timestamp: recent }),
        // Same message repeated per content block: must count once.
        claudeRow({ messageId: 'm1', timestamp: recent }),
        claudeRow({ messageId: 'm2', requestId: 'req-2', timestamp: recent, sessionId: 'sess-2' }),
        // Outside the 30-day window: excluded even though the file is fresh.
        claudeRow({ messageId: 'm3', requestId: 'req-3', timestamp: old }),
        'not json',
      ].join('\n'),
    );

    const summary = await getUsageSummary({
      days: 30,
      cacheDir: cache,
      sources: [{ agent: 'claude-code', dir: join(source, 'projects') }],
    });

    expect(summary.records).toBe(2);
    expect(summary.sessions).toBe(2);
    expect(summary.totalTokens).toBe(2 * 150);
    expect(summary.agents).toHaveLength(1);
    expect(summary.agents[0]?.agent).toBe('claude-code');
    expect(summary.models[0]?.model).toBe('claude-sonnet-4-20250514');
    // Empty rate table: everything is unpriced but tokens still count.
    expect(summary.unpricedRecords).toBe(2);
    expect(summary.costUsd).toBe(0);
    expect(summary.sources[0]?.status).toBe('scanned');
    expect(summary.sources[0]?.files).toBe(1);
    expect(summary.resolution).toBe('day');
    // Both in-range records land on today's bucket, split by agent.
    expect(summary.buckets).toHaveLength(1);
    expect(summary.buckets[0]?.totalTokens).toBe(300);
    expect(summary.buckets[0]?.byAgent['claude-code']?.totalTokens).toBe(300);

    // Second run hits the (size, mtime) scan cache and returns the same totals.
    const again = await getUsageSummary({
      days: 30,
      cacheDir: cache,
      sources: [{ agent: 'claude-code', dir: join(source, 'projects') }],
    });
    expect(again.records).toBe(2);
    expect(again.totalTokens).toBe(summary.totalTokens);
  });
});

test('keeps identical id-less transcript rows distinct with stable cloud keys', async () => {
  await withTempDirs(async ({ source, cache }) => {
    const projectDir = join(source, 'projects', 'my-repo');
    await mkdir(projectDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const row = JSON.stringify({
      type: 'assistant',
      timestamp,
      sessionId: 'legacy-session',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    await writeFile(join(projectDir, 'legacy.jsonl'), `${row}\n${row}\n`);

    const summary = await getUsageSummary({
      days: 30,
      cacheDir: cache,
      sources: [{ agent: 'claude-code', dir: join(source, 'projects') }],
    });

    expect(summary.records).toBe(2);
    expect(summary.totalTokens).toBe(300);
    expect(summary.dedupeKeys).toHaveLength(2);
    expect(new Set(summary.dedupeKeys)).toHaveLength(2);
    expect(summary.events?.map((event) => event.ownershipKey).sort()).toEqual(summary.dedupeKeys);
    expect(new Set(summary.events?.map((event) => event.key))).toHaveLength(1);
    expect(summary.events?.[0]?.key).toBe(
      `claude-code:legacy-session:${Date.parse(timestamp)}:claude-sonnet-4-20250514`,
    );

    const cached = await getUsageSummary({
      days: 30,
      cacheDir: cache,
      sources: [{ agent: 'claude-code', dir: join(source, 'projects') }],
    });
    expect(cached.dedupeKeys).toEqual(summary.dedupeKeys);

    const mirroredProjectDir = join(source, 'mirrored-projects', 'different-repo');
    await mkdir(mirroredProjectDir, { recursive: true });
    await writeFile(join(mirroredProjectDir, 'different-name.jsonl'), `${row}\n${row}\n`);
    const mirrored = await getUsageSummary({
      days: 30,
      cacheDir: join(cache, 'mirrored'),
      sources: [{ agent: 'claude-code', dir: join(source, 'mirrored-projects') }],
    });
    expect(mirrored.dedupeKeys).toEqual(summary.dedupeKeys);
  });
});

test('keeps id-less records distinct across transcript files', async () => {
  await withTempDirs(async ({ source, cache }) => {
    const projectDir = join(source, 'projects', 'my-repo');
    await mkdir(projectDir, { recursive: true });
    const row = JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      sessionId: 'shared-session',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    await writeFile(join(projectDir, 'a.jsonl'), `${row}\n`);
    await writeFile(join(projectDir, 'b.jsonl'), `${row}\n`);

    const summary = await getUsageSummary({
      days: 30,
      cacheDir: cache,
      sources: [{ agent: 'claude-code', dir: join(source, 'projects') }],
    });

    expect(summary.records).toBe(2);
    expect(summary.dedupeKeys).toHaveLength(2);
    expect(new Set(summary.events?.map((event) => event.ownershipKey))).toHaveLength(2);
  });
});

test('assigns id-less collision keys independently of transcript traversal order', async () => {
  await withTempDirs(async ({ source, cache }) => {
    const timestamp = new Date().toISOString();
    const row = (inputTokens: number) =>
      JSON.stringify({
        type: 'assistant',
        timestamp,
        sessionId: 'shared-session',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: inputTokens, output_tokens: 0 },
        },
      });
    const scan = async (device: string, first: string, second: string) => {
      const projectDir = join(source, device, 'projects');
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, 'a.jsonl'), `${first}\n`);
      await writeFile(join(projectDir, 'b.jsonl'), `${second}\n`);
      return getUsageSummary({
        days: 30,
        cacheDir: join(cache, device),
        sources: [{ agent: 'claude-code', dir: projectDir }],
      });
    };

    const first = row(100);
    const second = row(200);
    const left = await scan('left', first, second);
    const right = await scan('right', second, first);
    const keysByTokens = (summary: UsageSummary) =>
      Object.fromEntries(
        summary.events?.map((event) => [event.totals.uncachedInputTokens, event.ownershipKey]) ??
          [],
      );

    expect(keysByTokens(right)).toEqual(keysByTokens(left));
  });
});

test('getUsageSummary deterministically caps fallback Grok fingerprints', async () => {
  await withTempDirs(async ({ source, cache }) => {
    const sessionDir = join(source, 'session-x');
    await mkdir(sessionDir, { recursive: true });
    const timestamps = Array.from({ length: 20_001 }, (_, index) =>
      new Date(Date.now() - index * 1_000).toISOString(),
    );
    const rows = timestamps.map((timestamp) =>
      JSON.stringify({
        timestamp,
        update: {
          type: 'turn_completed',
          usage: {
            inputTokens: 2,
            outputTokens: 1,
          },
        },
      }),
    );
    await writeFile(join(sessionDir, 'updates.jsonl'), rows.join('\n'));

    const summary = await getUsageSummary({
      days: 30,
      cacheDir: cache,
      sources: [{ agent: 'grok', dir: source, fileName: 'updates.jsonl' }],
    });
    const expectedKeys = rows
      .flatMap((row, index) => parseGrokLine(row, 'grok:session-x', String(index + 1)))
      .map((record) => record.dedupeKey)
      .filter((key): key is string => key !== null)
      .sort()
      .slice(0, 8_192);

    expect(summary.records).toBe(20_001);
    expect(summary.events).toHaveLength(400);
    expect(summary.events?.[0]).toMatchObject({
      sessionId: 'grok:updates',
      ownershipSessionId: 'grok:session-x',
    });
    expect(summary.dedupeKeys).toEqual(expectedKeys);
  });
});

test('getUsageSummary reports missing source directories without failing', async () => {
  await withTempDirs(async ({ source, cache }) => {
    const summary = await getUsageSummary({
      days: 30,
      cacheDir: cache,
      sources: [{ agent: 'codex-cli', dir: join(source, 'does-not-exist') }],
    });
    expect(summary.records).toBe(0);
    expect(summary.sources[0]?.status).toBe('missing');
  });
});
