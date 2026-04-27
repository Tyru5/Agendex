import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agendex/shared';

const MAX_PENDING_WRITEBACK_REPORTS = 1000;

export type PendingWritebackReportStatus = 'sent' | 'expired';

function getCachePath(): string {
  return join(getConfigDir(), 'plannotator-writebacks-delivered.json');
}

function isPendingWritebackReportStatus(value: unknown): value is PendingWritebackReportStatus {
  return value === 'sent' || value === 'expired';
}

function normalizeReports(input: unknown): [string, PendingWritebackReportStatus][] {
  if (!Array.isArray(input)) return [];

  const reports = new Map<string, PendingWritebackReportStatus>();
  for (const item of input) {
    if (typeof item === 'string' && item.length > 0) {
      reports.set(item, 'sent');
      continue;
    }

    if (
      item &&
      typeof item === 'object' &&
      'id' in item &&
      'status' in item &&
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      isPendingWritebackReportStatus(item.status)
    ) {
      reports.set(item.id, item.status);
    }
  }

  return [...reports.entries()].slice(-MAX_PENDING_WRITEBACK_REPORTS);
}

export function loadPendingWritebackReports(): Map<string, PendingWritebackReportStatus> {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return new Map();

  try {
    return new Map(normalizeReports(JSON.parse(readFileSync(cachePath, 'utf-8'))));
  } catch {
    return new Map();
  }
}

export function savePendingWritebackReports(
  reports: ReadonlyMap<string, PendingWritebackReportStatus>,
): boolean {
  try {
    const dir = getConfigDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const normalizedReports = normalizeReports(
      [...reports].map(([id, status]) => ({ id, status })),
    );
    writeFileSync(
      getCachePath(),
      JSON.stringify(normalizedReports.map(([id, status]) => ({ id, status }))),
    );
    return true;
  } catch {
    return false;
  }
}
