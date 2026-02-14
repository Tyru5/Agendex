import type { AgentAdapter } from '../types.ts';
import {
  getAdapterCatalog,
  getCatalogDefaultAdapterIds,
  resolveAdapterId,
  type AdapterCatalogEntry,
  type AdapterId,
} from './catalog.ts';

const catalog = getAdapterCatalog();
const catalogById = new Map<AdapterId, AdapterCatalogEntry>(
  catalog.map((entry) => [entry.id, entry]),
);

export function getCatalog(): AdapterCatalogEntry[] {
  return catalog.map((entry) => ({ ...entry }));
}

export function getDefaultAdapterIds(): AdapterId[] {
  return getCatalogDefaultAdapterIds();
}

export function sanitizeEnabledAdapterIds(ids: string[]): AdapterId[] {
  const selected: AdapterId[] = [];
  const seen = new Set<AdapterId>();
  for (const id of ids) {
    const typedId = resolveAdapterId(id);
    if (!typedId || !catalogById.has(typedId)) continue;
    if (seen.has(typedId)) continue;
    seen.add(typedId);
    selected.push(typedId);
  }
  return selected;
}

export function resolveAdapters(enabledIds: string[]): AgentAdapter[] {
  const selectedIds = sanitizeEnabledAdapterIds(enabledIds);
  if (selectedIds.length === 0) {
    const defaults = getDefaultAdapterIds();
    return defaults.map((id) => {
      const entry = catalogById.get(id);
      if (!entry) throw new Error(`Adapter catalog missing entry for ${id}`);
      return entry.createAdapter();
    });
  }

  return selectedIds.map((id) => {
    const entry = catalogById.get(id);
    if (!entry) throw new Error(`Adapter catalog missing entry for ${id}`);
    return entry.createAdapter();
  });
}

export function setActiveAdapters(adapters: AgentAdapter[]) {
  activeAdapters = [...adapters];
}

export function getActiveAdapters(): AgentAdapter[] {
  return [...activeAdapters];
}

let activeAdapters: AgentAdapter[] = resolveAdapters(getDefaultAdapterIds());
