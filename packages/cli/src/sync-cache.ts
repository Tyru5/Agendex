import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agendex/shared';
import type { SyncPlanPayload } from './api.ts';

function getCachePath(scope: string): string {
  return join(getConfigDir(), `sync-cache-${scope}.json`);
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
  const cachePath = getCachePath(scope);
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
  const cachePath = getCachePath(options.scope);
  const plans = options.replace
    ? cache
    : // Merge with latest same-scope state to reduce lost updates from concurrent writers.
      { ...loadSyncCache(options.scope), ...cache };
  const file: SyncCacheFile = { version: 2, scope: options.scope, plans };
  writeFileSync(cachePath, JSON.stringify(file));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reduce `metadata.git` to its stable fields (repo/remote) for hashing.
 * Branch and HEAD move every time the user switches branches or commits; if
 * they participated in the hash, every plan in a workspace would re-sync
 * after each commit. The freshest branch/commit still upload whenever a plan
 * re-syncs for content or other metadata changes.
 */
function hashableMetadata(metadata: SyncPlanPayload['metadata']): unknown {
  if (!isRecord(metadata) || !isRecord(metadata.git)) return metadata ?? null;
  const { branch: _branch, commit: _commit, ...stableGit } = metadata.git;
  return { ...metadata, git: stableGit };
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
    hashableMetadata(payload.metadata),
    payload.createdAt ?? null,
    payload.updatedAt ?? null,
    payload.syncIdentityKey ?? null,
    payload.contentHash ?? null,
    payload.identityVersion ?? null,
    payload.identityStrength ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 20);
}
