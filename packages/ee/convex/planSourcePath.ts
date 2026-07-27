/**
 * Mirrors the client-side custom source key normalization
 * (`src/lib/cloud-plan-sources.ts`): backslashes become forward slashes and
 * trailing slashes are stripped, so Windows paths like `C:\dir\` match the
 * sidebar keys (`C:/dir`) the dashboard sends.
 */
export function normalizePlanSourcePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Whether a plan's metadata marks it as synced from the given custom source dir. */
export function planMatchesSource(metadata: unknown, normalizedSource: string): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const { source, customDir } = metadata as { source?: unknown; customDir?: unknown };
  if (source !== 'custom-dir' || typeof customDir !== 'string') return false;
  return normalizePlanSourcePath(customDir) === normalizedSource;
}
