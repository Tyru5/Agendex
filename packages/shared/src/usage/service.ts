/**
 * Usage scanner: walks each agent CLI's native transcript directory, streams
 * JSONL files line-by-line, normalizes usage events, prices them, and
 * aggregates one `UsageSummary` (overall + per-agent + per-model).
 *
 * Raw transcripts never leave this module — only aggregated totals do.
 * Per-file parse results are cached by (size, mtime) in the Agendex config
 * dir so rescans only reparse files that changed.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { getConfigDir } from '../config.ts';
import { getHomeDir } from '../home-dir.ts';
import { loadModelRates, lookupRate, type ModelRateTable, priceUsage } from './pricing.ts';
import {
  createCodexState,
  mightCarryUsage,
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
} from './transcripts.ts';
import {
  addTokenTotals,
  type AgentUsageTotals,
  emptyTokenTotals,
  type ModelUsageTotals,
  totalTokens,
  type UsageAgent,
  type UsageBucket,
  type UsageRecord,
  type UsageSourceStatus,
  type UsageSummary,
} from './types.ts';

const SCAN_CACHE_FILE = 'usage-scan-cache.json';
const SCAN_CACHE_VERSION = 1;
export const DEFAULT_USAGE_DAYS = 30;

interface UsageSource {
  agent: UsageAgent;
  dir: string;
  /** When set, only files with this exact basename are scanned. */
  fileName?: string;
}

function usageSources(): UsageSource[] {
  const home = getHomeDir();
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return [
    {
      agent: 'claude-code',
      dir: join(claudeConfigDir || join(home, '.claude'), 'projects'),
    },
    { agent: 'codex-cli', dir: join(home, '.codex', 'sessions') },
    { agent: 'grok', dir: join(home, '.grok', 'sessions'), fileName: 'updates.jsonl' },
  ];
}

// ---------------------------------------------------------------------------
// File walking + streaming parse
// ---------------------------------------------------------------------------

interface CandidateFile {
  path: string;
  size: number;
  mtimeMs: number;
}

async function walkJsonlFiles(
  dir: string,
  sinceMs: number,
  fileName: string | undefined,
  out: CandidateFile[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonlFiles(path, sinceMs, fileName, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (fileName ? entry.name !== fileName : !entry.name.endsWith('.jsonl')) continue;
    try {
      const stats = await stat(path);
      // A file whose last write predates the window cannot contain in-range
      // records; record timestamps filter the rest.
      if (stats.mtimeMs < sinceMs) continue;
      out.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      // File vanished between readdir and stat; skip it.
    }
  }
}

async function parseTranscriptFile(agent: UsageAgent, path: string): Promise<UsageRecord[]> {
  const fallbackSessionId = `${agent}:${basename(path, '.jsonl')}`;
  const records: UsageRecord[] = [];
  const codexState = agent === 'codex-cli' ? createCodexState(fallbackSessionId) : null;

  const stream = createReadStream(path, { encoding: 'utf-8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!mightCarryUsage(agent, line)) continue;
      if (agent === 'claude-code') {
        const record = parseClaudeLine(line, fallbackSessionId);
        if (record) records.push(record);
      } else if (agent === 'codex-cli' && codexState) {
        const record = parseCodexLine(line, codexState);
        if (record) records.push(record);
      } else if (agent === 'grok') {
        records.push(...parseGrokLine(line, fallbackSessionId));
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return records;
}

// ---------------------------------------------------------------------------
// Per-file scan cache
// ---------------------------------------------------------------------------

interface ScanCacheEntry {
  size: number;
  mtimeMs: number;
  records: UsageRecord[];
}

interface ScanCache {
  version: number;
  files: Record<string, ScanCacheEntry>;
}

async function readScanCache(path: string): Promise<ScanCache> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as ScanCache;
    if (parsed?.version === SCAN_CACHE_VERSION && parsed.files) return parsed;
  } catch {
    // Missing or corrupt cache: rebuild from scratch.
  }
  return { version: SCAN_CACHE_VERSION, files: {} };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface MutableAgentTotals extends Omit<AgentUsageTotals, 'sessions'> {
  sessionIds: Set<string>;
}

/**
 * Bucket key in the server's local timezone: the local app runs on the same
 * machine as the viewer, so local calendar days match what the user expects.
 */
function bucketStart(timestampMs: number, resolution: 'day' | 'hour'): string {
  const date = new Date(timestampMs);
  if (resolution === 'hour') {
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function aggregate(
  records: UsageRecord[],
  rateTable: ModelRateTable,
  sources: UsageSourceStatus[],
  days: number,
  scanDurationMs: number,
): UsageSummary {
  const overall = emptyTokenTotals();
  let costUsd = 0;
  let cacheSavingsUsd = 0;
  let unpricedRecords = 0;

  const byAgent = new Map<UsageAgent, MutableAgentTotals>();
  const byModel = new Map<string, ModelUsageTotals>();
  const resolution: 'day' | 'hour' = days === 1 ? 'hour' : 'day';
  const byBucket = new Map<string, UsageBucket>();

  for (const record of records) {
    const rate = lookupRate(rateTable, record.model);
    const priced = priceUsage(record.totals, record.reportedCostUsd, rate);

    addTokenTotals(overall, record.totals);
    costUsd += priced.costUsd;
    cacheSavingsUsd += priced.cacheSavingsUsd;
    if (!priced.priced) unpricedRecords++;

    const start = bucketStart(record.timestampMs, resolution);
    let bucket = byBucket.get(start);
    if (!bucket) {
      bucket = { start, costUsd: 0, totalTokens: 0, byAgent: {} };
      byBucket.set(start, bucket);
    }
    const recordTokens = totalTokens(record.totals);
    bucket.costUsd += priced.costUsd;
    bucket.totalTokens += recordTokens;
    const bucketAgent = (bucket.byAgent[record.agent] ??= { costUsd: 0, totalTokens: 0 });
    bucketAgent.costUsd += priced.costUsd;
    bucketAgent.totalTokens += recordTokens;

    let agentTotals = byAgent.get(record.agent);
    if (!agentTotals) {
      agentTotals = {
        agent: record.agent,
        totals: emptyTokenTotals(),
        totalTokens: 0,
        costUsd: 0,
        records: 0,
        unpricedRecords: 0,
        sessionIds: new Set(),
      };
      byAgent.set(record.agent, agentTotals);
    }
    addTokenTotals(agentTotals.totals, record.totals);
    agentTotals.costUsd += priced.costUsd;
    agentTotals.records++;
    if (!priced.priced) agentTotals.unpricedRecords++;
    agentTotals.sessionIds.add(record.sessionId);

    const modelKey = `${record.agent}\u0000${record.model}`;
    let modelTotals = byModel.get(modelKey);
    if (!modelTotals) {
      modelTotals = {
        agent: record.agent,
        model: record.model,
        totals: emptyTokenTotals(),
        totalTokens: 0,
        costUsd: 0,
        records: 0,
        unpricedRecords: 0,
      };
      byModel.set(modelKey, modelTotals);
    }
    addTokenTotals(modelTotals.totals, record.totals);
    modelTotals.costUsd += priced.costUsd;
    modelTotals.records++;
    if (!priced.priced) modelTotals.unpricedRecords++;
  }

  const agents: AgentUsageTotals[] = Array.from(byAgent.values())
    .map(({ sessionIds, ...rest }) => ({
      ...rest,
      totalTokens: totalTokens(rest.totals),
      sessions: sessionIds.size,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const models: ModelUsageTotals[] = Array.from(byModel.values())
    .map((m) => ({ ...m, totalTokens: totalTokens(m.totals) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  return {
    generatedAt: new Date().toISOString(),
    days,
    resolution,
    buckets: Array.from(byBucket.values()).sort((a, b) => a.start.localeCompare(b.start)),
    totals: overall,
    totalTokens: totalTokens(overall),
    costUsd,
    cacheSavingsUsd,
    records: records.length,
    unpricedRecords,
    sessions: agents.reduce((sum, a) => sum + a.sessions, 0),
    agents,
    models,
    sources,
    scanDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface GetUsageSummaryOptions {
  /** Rolling window size in days. Defaults to 30. */
  days?: number;
  /** Override the source list (tests). */
  sources?: UsageSource[];
  /** Override the scan-cache directory (tests). */
  cacheDir?: string;
}

/**
 * Scan transcript sources once for the largest requested window, then derive
 * each window's summary from the shared record set. Avoids repeated directory
 * walks when the daemon publishes several cloud windows together.
 */
export async function getUsageSummaries(
  windows: readonly number[],
  options: Omit<GetUsageSummaryOptions, 'days'> = {},
): Promise<Record<string, UsageSummary>> {
  const startedAt = Date.now();
  const uniqueDays = [
    ...new Set(
      windows.map((days) => Math.min(Math.max(Math.floor(days), 1), 365)).filter((days) => days > 0),
    ),
  ].sort((a, b) => b - a);
  if (uniqueDays.length === 0) return {};

  const maxDays = uniqueDays[0]!;
  const sinceMs = startedAt - maxDays * 24 * 60 * 60 * 1000;
  const cacheDir = options.cacheDir ?? getConfigDir();
  const cachePath = join(cacheDir, SCAN_CACHE_FILE);

  const [rateTable, cache] = await Promise.all([
    loadModelRates({ cacheDir }),
    readScanCache(cachePath),
  ]);

  const sources = options.sources ?? usageSources();
  const sourceStatuses: UsageSourceStatus[] = [];
  // Only files touched this scan — merged with the on-disk cache on write so
  // overlapping day-window requests do not discard each other's entries.
  const updatedCacheFiles: Record<string, ScanCacheEntry> = {};
  const records: UsageRecord[] = [];
  const seenDedupeKeys = new Set<string>();

  for (const source of sources) {
    const candidates: CandidateFile[] = [];
    try {
      await walkJsonlFiles(source.dir, sinceMs, source.fileName, candidates);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
      sourceStatuses.push({
        agent: source.agent,
        path: source.dir,
        status: missing ? 'missing' : 'error',
        files: 0,
        ...(missing ? {} : { message: error instanceof Error ? error.message : String(error) }),
      });
      continue;
    }

    for (const file of candidates) {
      const cached = cache.files[file.path];
      let fileRecords: UsageRecord[];
      if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
        fileRecords = cached.records;
      } else {
        try {
          fileRecords = await parseTranscriptFile(source.agent, file.path);
        } catch {
          continue;
        }
      }
      updatedCacheFiles[file.path] = {
        size: file.size,
        mtimeMs: file.mtimeMs,
        records: fileRecords,
      };

      for (const record of fileRecords) {
        if (record.timestampMs < sinceMs || record.timestampMs > startedAt + 60_000) continue;
        if (record.dedupeKey !== null) {
          if (seenDedupeKeys.has(record.dedupeKey)) continue;
          seenDedupeKeys.add(record.dedupeKey);
        }
        records.push(record);
      }
    }

    sourceStatuses.push({
      agent: source.agent,
      path: source.dir,
      status: 'scanned',
      files: candidates.length,
    });
  }

  // Persist best-effort: re-read then merge so concurrent window scans keep
  // reusable entries from other day windows.
  try {
    await mkdir(cacheDir, { recursive: true });
    const latest = await readScanCache(cachePath);
    await writeFile(
      cachePath,
      JSON.stringify({
        version: SCAN_CACHE_VERSION,
        files: { ...latest.files, ...updatedCacheFiles },
      } satisfies ScanCache),
    );
  } catch {
    // Read-only config dir: totals still work, rescans just reparse.
  }

  const scanDurationMs = Date.now() - startedAt;
  const summaries: Record<string, UsageSummary> = {};
  for (const days of uniqueDays) {
    const windowSinceMs = startedAt - days * 24 * 60 * 60 * 1000;
    const windowRecords =
      days === maxDays ? records : records.filter((record) => record.timestampMs >= windowSinceMs);
    summaries[String(days)] = aggregate(
      windowRecords,
      rateTable,
      sourceStatuses,
      days,
      scanDurationMs,
    );
  }
  return summaries;
}

export async function getUsageSummary(options: GetUsageSummaryOptions = {}): Promise<UsageSummary> {
  const days = Math.min(Math.max(Math.floor(options.days ?? DEFAULT_USAGE_DAYS), 1), 365);
  const summaries = await getUsageSummaries([days], options);
  return summaries[String(days)]!;
}
