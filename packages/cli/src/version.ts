import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pkg from '../package.json';

export const CLI_VERSION: string = pkg.version;

interface UpdateResult {
  updateAvailable: boolean;
  current: string;
  latest: string;
}

const CACHE_FILE = join(tmpdir(), '.agendex-update-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readCache(): UpdateResult | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const { result, ts } = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return result as UpdateResult;
  } catch {
    return null;
  }
}

function writeCache(result: UpdateResult): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ result, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const current = CLI_VERSION;

  const cached = readCache();
  if (cached) return { ...cached, current };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('https://registry.npmjs.org/agendex-cli/latest', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { updateAvailable: false, current, latest: current };
    }

    const data = (await res.json()) as { version: string };
    const latest = data.version;

    const result: UpdateResult = { updateAvailable: isNewer(latest, current), current, latest };
    writeCache(result);
    return result;
  } catch {
    return { updateAvailable: false, current, latest: current };
  }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] ?? 0;
    const cv = c[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}
