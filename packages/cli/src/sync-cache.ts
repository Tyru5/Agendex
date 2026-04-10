import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agendex/shared';
import type { SyncPlanPayload } from './api.ts';

function getCachePath(): string {
  return join(getConfigDir(), 'sync-cache.json');
}

export function loadSyncCache(): Record<string, string> {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveSyncCache(
  cache: Record<string, string>,
  options?: { replace?: boolean },
): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cachePath = getCachePath();
  if (options?.replace) {
    writeFileSync(cachePath, JSON.stringify(cache));
    return;
  }

  // Merge with latest on-disk state to reduce lost updates from concurrent writers.
  const existing = loadSyncCache();
  writeFileSync(cachePath, JSON.stringify({ ...existing, ...cache }));
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
