import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export type DashboardMode = 'local' | 'cloud';

function modePrefPath(): string {
  return join(app.getPath('userData'), 'agendex-dashboard-mode.json');
}

export function loadModePref(): DashboardMode | null {
  try {
    const path = modePrefPath();
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { mode?: string };
    return raw.mode === 'local' || raw.mode === 'cloud' ? raw.mode : null;
  } catch {
    return null;
  }
}

export function saveModePref(mode: DashboardMode): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(modePrefPath(), JSON.stringify({ mode }), 'utf8');
}
