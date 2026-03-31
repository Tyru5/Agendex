import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SyncPlanPayload } from './api.ts';

const CACHE_PATH = join(homedir(), '.agendex', 'sync-cache.json');

export function loadSyncCache(): Record<string, string> {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveSyncCache(cache: Record<string, string>): void {
  const dir = join(homedir(), '.agendex');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Merge with latest on-disk state to reduce lost updates from concurrent writers.
  const existing = loadSyncCache();
  writeFileSync(CACHE_PATH, JSON.stringify({ ...existing, ...cache }));
}

export function computePayloadHash(payload: SyncPlanPayload): string {
  const canonical = JSON.stringify([
    payload.localPlanId,
    payload.agent,
    payload.title,
    payload.content,
    payload.format,
    payload.filePath ?? null,
    payload.workspace ?? null,
    payload.metadata ?? null,
    payload.createdAt ?? null,
    payload.updatedAt ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 20);
}
