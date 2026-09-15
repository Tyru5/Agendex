/**
 * Usage scanner: walks each agent CLI's native transcript directory, streams
 * JSONL files line-by-line, normalizes usage events, prices them, and
 * aggregates one `UsageSummary` (overall + per-agent + per-model).
 *
 * Raw transcripts never leave this module — only aggregated totals do.
 * Per-file parse results are cached by (size, mtime) in the Agendex config
 * dir so rescans only reparse files that changed.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
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
  type UsageCloudEvent,
  type UsageRecord,
  type UsageSourceStatus,
  type UsageSummary,
} from './types.ts';

const SCAN_CACHE_FILE = 'usage-scan-cache.json';
const SCAN_CACHE_VERSION = 5;
export const DEFAULT_USAGE_DAYS = 30;
/** Soft cap so multi-window cloud snapshots stay under the heartbeat byte budget. */
const MAX_CLOUD_EVENTS = 400;

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
  const fallbackName = agent === 'grok' ? basename(dirname(path)) : basename(path, '.jsonl');
  const fallbackSessionId = `${agent}:${fallbackName}`;
  const legacyFallbackSessionId = `${agent}:${basename(path, '.jsonl')}`;
  const records: UsageRecord[] = [];
  const codexState = agent === 'codex-cli' ? createCodexState(fallbackSessionId) : null;

  const stream = createReadStream(path, { encoding: 'utf-8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!mightCarryUsage(agent, line)) continue;
      let parsed: UsageRecord[] = [];
      if (agent === 'claude-code') {
        const record = parseClaudeLine(line, fallbackSessionId);
        if (record) parsed = [record];
      } else if (agent === 'codex-cli' && codexState) {
        const record = parseCodexLine(line, codexState);
        if (record) parsed = [record];
      } else if (agent === 'grok') {
        parsed = parseGrokLine(line, fallbackSessionId, String(lineNumber));
      }
      for (const record of parsed) {
        record.cloudSourcePosition = String(lineNumber);
        if (
          agent === 'grok' &&
          record.preserveLegacyCloudKey === true &&
          record.sessionId === fallbackSessionId
        ) {
          record.legacyCloudSessionId = legacyFallbackSessionId;
        }
        records.push(record);
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

function legacyCloudDedupeKey(record: UsageRecord): string {
  const sessionId = record.legacyCloudSessionId ?? record.sessionId;
  return `${record.agent}:${sessionId}:${record.timestampMs}:${record.model}`;
}

function boundedCloudDedupeKey(record: UsageRecord, sourcePosition = ''): string {
  if (record.dedupeKey && record.dedupeKey.length <= 256) return record.dedupeKey;
  const material =
    record.dedupeKey ??
    JSON.stringify([
      record.agent,
      record.sessionId,
      sourcePosition,
      record.timestampMs,
      record.model,
      record.totals,
      record.reportedCostUsd,
    ]);
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
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
  const events: UsageCloudEvent[] = [];
  const dedupeKeys = new Set<string>();

  for (const [recordIndex, record] of records.entries()) {
    const rate = lookupRate(rateTable, record.model);
    const priced = priceUsage(record.totals, record.reportedCostUsd, rate);
    const eventKey = record.cloudDedupeKey ?? boundedCloudDedupeKey(record, String(recordIndex));
    dedupeKeys.add(eventKey);
    const start = bucketStart(record.timestampMs, resolution);

    if (events.length < MAX_CLOUD_EVENTS) {
      events.push({
        key: record.cloudLegacyDedupeKey ?? eventKey,
        ...(record.cloudLegacyDedupeKey ? { ownershipKey: eventKey } : {}),
        agent: record.agent,
        model: record.model,
        timestampMs: record.timestampMs,
        bucketStart: start,
        sessionId: record.legacyCloudSessionId ?? record.sessionId,
        ...(record.legacyCloudSessionId && record.legacyCloudSessionId !== record.sessionId
          ? { ownershipSessionId: record.sessionId }
          : {}),
        totals: { ...record.totals },
        costUsd: priced.costUsd,
        cacheSavingsUsd: priced.cacheSavingsUsd,
        unpriced: !priced.priced,
      });
    }

    addTokenTotals(overall, record.totals);
    costUsd += priced.costUsd;
    cacheSavingsUsd += priced.cacheSavingsUsd;
    if (!priced.priced) unpricedRecords++;
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
    // Opaque keys cover the full window; events are capped for heartbeat size.
    dedupeKeys: Array.from(dedupeKeys).sort().slice(0, 8_192),
    ...(events.length > 0 ? { events } : {}),
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
      windows
        .map((days) => Math.min(Math.max(Math.floor(days), 1), 365))
        .filter((days) => days > 0),
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
  const legacyCloudKeyGroups = new Map<string, UsageRecord[]>();

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

    candidates.sort((a, b) => a.path.localeCompare(b.path));
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

      for (const [recordIndex, record] of fileRecords.entries()) {
        if (record.timestampMs < sinceMs || record.timestampMs > startedAt + 60_000) continue;
        const sourcePosition = `${relative(source.dir, file.path).replaceAll('\\', '/')}:${record.cloudSourcePosition ?? recordIndex + 1}`;
        const preserveLegacyIdentity =
          record.preserveLegacyCloudKey === true || record.dedupeKey === null;
        if (preserveLegacyIdentity) {
          const legacyKey = legacyCloudDedupeKey(record);
          const group = legacyCloudKeyGroups.get(legacyKey);
          if (group) group.push(record);
          else legacyCloudKeyGroups.set(legacyKey, [record]);
        } else {
          record.cloudDedupeKey = boundedCloudDedupeKey(record, sourcePosition);
        }
        // Defer dedupe until each window is derived so a key that only collides
        // with an out-of-window older record still counts in smaller windows.
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

  for (const [legacyKey, group] of legacyCloudKeyGroups) {
    const fingerprintOccurrences = new Map<string, number>();
    for (const record of group) {
      const fingerprint = boundedCloudDedupeKey(record);
      const occurrence = fingerprintOccurrences.get(fingerprint) ?? 0;
      fingerprintOccurrences.set(fingerprint, occurrence + 1);
      record.cloudLegacyDedupeKey = legacyKey;
      record.cloudDedupeKey =
        record.dedupeKey ??
        boundedCloudDedupeKey(record, `legacy:${legacyKey}:${fingerprint}:${occurrence}`);
    }
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
    const seenDedupeKeys = new Set<string>();
    const windowRecords: UsageRecord[] = [];
    for (const record of records) {
      if (record.timestampMs < windowSinceMs) continue;
      if (record.dedupeKey !== null) {
        if (seenDedupeKeys.has(record.dedupeKey)) continue;
        seenDedupeKeys.add(record.dedupeKey);
      }
      windowRecords.push(record);
    }
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
