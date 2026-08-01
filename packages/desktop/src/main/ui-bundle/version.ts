/**
 * Numeric-segment version comparison, enough for the `minShellVersion` gate.
 *
 * Only the leading `major.minor.patch` numbers are compared; any prerelease or
 * build suffix (`1.4.15-beta.2`, `1.4.15+ui.3`) is ignored. That is deliberate:
 * the gate asks "does this shell have the capabilities the UI needs", and a
 * prerelease of 1.4.16 has 1.4.16's IPC surface.
 */
export function compareVersions(a: string, b: string): number {
  const segments = (value: string): number[] =>
    value
      .split(/[-+]/, 1)[0]!
      .split('.')
      .map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      });

  const left = segments(a);
  const right = segments(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when `shellVersion` is new enough to run a bundle needing `required`. */
export function satisfiesMinShellVersion(shellVersion: string, required: string): boolean {
  return compareVersions(shellVersion, required) >= 0;
}
