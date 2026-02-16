import { readdir, lstat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { existsSync } from 'fs';
import { getActiveAdapters } from '../adapters/registry.ts';
import type { Plan } from '../types.ts';

const store = new Map<string, Plan>();
const MAX_DEPTH = 6;

let onPlansChangedCallback: ((plans: Plan[]) => void) | undefined;

export function setOnPlansChanged(callback: (plans: Plan[]) => void) {
  onPlansChangedCallback = callback;
}

function notifyPlansChanged() {
  onPlansChangedCallback?.(Array.from(store.values()));
}

async function walkDir(dir: string, depth = 0, seen = new Set<string>()): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  if (!existsSync(dir)) return [];

  const real = resolve(dir);
  if (seen.has(real)) return [];
  seen.add(real);

  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        const stats = await lstat(full);
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) {
          files.push(...(await walkDir(full, depth + 1, seen)));
        } else {
          files.push(full);
        }
      } catch {
        continue;
      }
    }
  } catch {
    // permission denied or similar
  }
  return files;
}

export async function scan() {
  const adapters = getActiveAdapters();
  store.clear();
  for (const adapter of adapters) {
    for (const searchPath of adapter.getSearchPaths()) {
      const files = await walkDir(searchPath);
      for (const file of files) {
        if (!adapter.matches(file)) continue;
        const plans = await adapter.parse(file);
        for (const plan of plans) {
          store.set(plan.id, plan);
        }
      }
    }
  }
  notifyPlansChanged();
  console.log(`[agendex] indexed ${store.size} plans from ${adapters.length} adapters`);
}

export function getAll(): Plan[] {
  return Array.from(store.values());
}

export function getById(id: string): Plan | undefined {
  return store.get(id);
}

export async function update(id: string, content: string): Promise<boolean> {
  const adapters = getActiveAdapters();
  const plan = store.get(id);
  if (!plan) return false;

  const adapter = adapters.find((a) => a.agent === plan.agent);
  if (!adapter?.writable) return false;

  const ok = await adapter.write(plan, content);
  if (ok) {
    plan.content = content;
    plan.updatedAt = new Date();
    notifyPlansChanged();
  }
  return ok;
}

export function getAgentStats() {
  const adapters = getActiveAdapters();
  const stats = new Map<string, { count: number; writable: boolean }>();
  for (const adapter of adapters) {
    stats.set(adapter.agent, { count: 0, writable: adapter.writable });
  }
  for (const plan of store.values()) {
    const s = stats.get(plan.agent);
    if (s) s.count++;
  }
  return Array.from(stats.entries()).map(([agent, s]) => ({
    agent,
    planCount: s.count,
    writable: s.writable,
  }));
}

export async function rescanFile(filePath: string) {
  const adapters = getActiveAdapters();
  const normalized = resolve(filePath);

  for (const adapter of adapters) {
    if (!adapter.matches(filePath)) continue;

    const isInSearchPath = adapter.getSearchPaths().some((sp) => {
      const searchNormalized = resolve(sp);
      return normalized.startsWith(searchNormalized + sep);
    });

    if (!isInSearchPath) continue;

    const plans = await adapter.parse(filePath);
    for (const plan of plans) {
      store.set(plan.id, plan);
    }
    notifyPlansChanged();
    return plans;
  }

  return [];
}
