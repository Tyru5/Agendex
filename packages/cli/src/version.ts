import pkg from '../package.json';

export const CLI_VERSION: string = pkg.version;

interface UpdateResult {
  updateAvailable: boolean;
  current: string;
  latest: string;
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const current = CLI_VERSION;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('https://registry.npmjs.org/agendex-cli/latest', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = (await res.json()) as { version: string };
    const latest = data.version;

    return { updateAvailable: isNewer(latest, current), current, latest };
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
