import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUsageSummary } from './service.ts';

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
