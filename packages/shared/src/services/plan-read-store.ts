import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { getConfigDir } from '../config';
import { MAX_READ_SNAPSHOT_BYTES, type PlanReadResult, type PlanReadSnapshot } from '../plan-read';

export const MAX_READ_SNAPSHOTS = 100;
export const MAX_READ_STORE_BYTES = 8 * 1024 * 1024;
type Source = { id: string; agent: string; filePath: string; workspace?: string };
type Entry = { planId: string; source: string; snapshot: PlanReadSnapshot; readAt: number };
type Store = { version: 1; entries: Record<string, Entry> };
function sourceIdentity(plan: Source): string {
  return JSON.stringify([plan.id, plan.agent, plan.filePath, plan.workspace ?? '']);
}
function sourceKey(plan: Source): string {
  return createHash('sha256').update(sourceIdentity(plan)).digest('hex');
}
function validEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Entry>;
  return (
    typeof row.planId === 'string' &&
    typeof row.source === 'string' &&
    typeof row.readAt === 'number' &&
    Number.isFinite(row.readAt) &&
    !!row.snapshot &&
    typeof row.snapshot.title === 'string' &&
    typeof row.snapshot.content === 'string' &&
    typeof row.snapshot.updatedAt === 'string' &&
    Buffer.byteLength(JSON.stringify(row.snapshot)) <= MAX_READ_SNAPSHOT_BYTES
  );
}
async function load(path: string): Promise<Store> {
  try {
    if ((await stat(path)).size > MAX_READ_STORE_BYTES) return { version: 1, entries: {} };
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      data.version !== 1 ||
      !data.entries ||
      typeof data.entries !== 'object' ||
      Array.isArray(data.entries)
    )
      return { version: 1, entries: {} };
    const entries: Record<string, Entry> = {};
    for (const [key, entry] of Object.entries(data.entries))
      if (validEntry(entry)) entries[key] = entry;
    return { version: 1, entries };
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, entries: {} };
    throw error;
  }
}
async function mutate<T>(directory: string, apply: (store: Store) => T): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'plan-read-snapshots.json');
  const release = await lockfile.lock(directory, {
    realpath: false,
    lockfilePath: `${path}.lock`,
    retries: { retries: 20, minTimeout: 10, maxTimeout: 100 },
  });
  try {
    const store = await load(path);
    const result = apply(store);
    const sorted = Object.entries(store.entries).sort((a, b) => b[1].readAt - a[1].readAt);
    store.entries = Object.fromEntries(sorted.slice(0, MAX_READ_SNAPSHOTS));
    while (Buffer.byteLength(JSON.stringify(store)) > MAX_READ_STORE_BYTES) {
      const oldest = Object.keys(store.entries).pop();
      if (!oldest) break;
      delete store.entries[oldest];
    }
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return result;
  } finally {
    await release();
  }
}
/** Atomically returns the PREVIOUS actual read and then records this content. */
export async function openPlanRead(
  plan: Source & PlanReadSnapshot,
  directory = getConfigDir(),
): Promise<PlanReadResult> {
  return mutate(directory, (store) => {
    const key = sourceKey(plan);
    const previous = store.entries[key];
    const snapshot = { title: plan.title, content: plan.content, updatedAt: plan.updatedAt };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_READ_SNAPSHOT_BYTES) {
      delete store.entries[key];
      return { baseline: null, reason: 'too-large' };
    }
    store.entries[key] = {
      planId: plan.id,
      source: sourceIdentity(plan),
      snapshot,
      readAt: Math.max(
        Date.now(),
        ...Object.values(store.entries).map((entry) => entry.readAt + 1),
      ),
    };
    return {
      baseline: previous?.source === sourceIdentity(plan) ? previous.snapshot : null,
      reason: previous ? 'available' : 'first-read',
    };
  });
}
export async function clearPlanRead(plan: Source, directory = getConfigDir()): Promise<void> {
  await mutate(directory, (store) => {
    delete store.entries[sourceKey(plan)];
  });
}
