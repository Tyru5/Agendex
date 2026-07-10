import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agendex/shared';
import type { SyncPlanPayload } from './api.ts';

function getCachePath(): string {
  return join(getConfigDir(), 'sync-cache.json');
}

interface SyncCacheFile {
  version: 2;
  scope: string;
  plans: Record<string, string>;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function parseSyncCache(raw: unknown): SyncCacheFile | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const file = raw as Partial<SyncCacheFile>;
  if (file.version !== 2 || typeof file.scope !== 'string' || !isStringRecord(file.plans)) {
    return null;
  }
  return { version: 2, scope: file.scope, plans: file.plans };
}

export function loadSyncCache(scope: string): Record<string, string> {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return {};
  try {
    const parsed = parseSyncCache(JSON.parse(readFileSync(cachePath, 'utf-8')));
    return parsed?.scope === scope ? parsed.plans : {};
  } catch {
    return {};
  }
}

export function saveSyncCache(
  cache: Record<string, string>,
  options: { scope: string; replace?: boolean },
): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cachePath = getCachePath();
  const plans = options.replace
    ? cache
    : // Merge with latest same-scope state to reduce lost updates from concurrent writers.
      { ...loadSyncCache(options.scope), ...cache };
  const file: SyncCacheFile = { version: 2, scope: options.scope, plans };
  writeFileSync(cachePath, JSON.stringify(file));
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
    payload.syncIdentityKey ?? null,
    payload.contentHash ?? null,
    payload.identityVersion ?? null,
    payload.identityStrength ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 20);
}
