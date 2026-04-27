import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agendex/shared';

const MAX_DELIVERED_WRITEBACK_IDS = 1000;

function getCachePath(): string {
  return join(getConfigDir(), 'plannotator-writebacks-delivered.json');
}

function normalizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const ids = input.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return [...new Set(ids)].slice(-MAX_DELIVERED_WRITEBACK_IDS);
}

export function loadDeliveredWritebackIds(): Set<string> {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return new Set();

  try {
    return new Set(normalizeIds(JSON.parse(readFileSync(cachePath, 'utf-8'))));
  } catch {
    return new Set();
  }
}

export function saveDeliveredWritebackIds(ids: Iterable<string>): boolean {
  try {
    const dir = getConfigDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getCachePath(), JSON.stringify(normalizeIds([...ids])));
    return true;
  } catch {
    return false;
  }
}
