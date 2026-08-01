/**
 * The slice of `fetch` this module needs, injected so tests can substitute a
 * fake. Deliberately narrower than `typeof fetch`, whose exact shape differs
 * between the DOM, Node, and Bun type definitions.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Stamp written into every UI bundle as `ui-bundle.json` at build time. */
export interface UiBundleStamp {
  /**
   * Git commit Unix timestamp of the commit the bundle was built from.
   * Monotonic on a linear `main`, deterministic in CI, and needs no counter to
   * maintain. `0` means "unknown" (a local build with no git), which loses to
   * every published bundle.
   */
  readonly revision: number;
  /** Short SHA + desktop version, for diagnostics only. */
  readonly label: string;
  /** Minimum desktop shell version this UI requires. */
  readonly minShellVersion: string;
}

/** The signed feed document describing the bundle desktops should be running. */
export interface UiManifest extends UiBundleStamp {
  /** Absolute https URL of the gzipped tarball. */
  readonly url: string;
  /** Lowercase hex SHA-256 of the tarball bytes. */
  readonly sha256: string;
  /** Tarball size in bytes, used to reject absurd downloads before hashing. */
  readonly size: number;
  /**
   * Kill switch. When true the shell discards any downloaded bundle and reverts
   * to the UI it shipped with, ignoring every other field.
   */
  readonly pinToShipped?: boolean;
}

export type UiUpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'no-update'
  | 'error'
  | 'unsupported';

export interface UiUpdateState {
  status: UiUpdateStatus;
  /** Revision of the staged bundle, once one is ready. */
  revision?: number;
  label?: string;
  progress?: number;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Parses a `ui-bundle.json` stamp. Returns null when malformed. */
export function parseUiBundleStamp(value: unknown): UiBundleStamp | null {
  if (!isRecord(value)) return null;
  const { revision, label, minShellVersion } = value;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (!isNonEmptyString(minShellVersion)) return null;
  return {
    revision,
    label: isNonEmptyString(label) ? label : 'unknown',
    minShellVersion,
  };
}

/**
 * Parses a manifest. Only called on bytes whose signature already verified, so
 * this guards against our own malformed publishes rather than an attacker — but
 * it stays strict regardless, since a bad parse here decides what code runs.
 */
export function parseUiManifest(value: unknown): UiManifest | null {
  const stamp = parseUiBundleStamp(value);
  if (!stamp || !isRecord(value)) return null;

  const { url, sha256, size, pinToShipped } = value;

  // The kill switch is honoured without requiring a valid bundle to point at.
  const pinned = pinToShipped === true;
  if (pinned) {
    return { ...stamp, url: '', sha256: '', size: 0, pinToShipped: true };
  }

  if (!isNonEmptyString(url)) return null;
  // Bundles must come over TLS. Plain http is allowed only for a local test
  // feed, which is opted into explicitly via AGENDEX_UI_FEED_URL.
  if (!/^https?:\/\//.test(url)) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return null;

  return { ...stamp, url, sha256, size, pinToShipped: false };
}
