import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUiBundleStamp, type UiBundleStamp } from './types.ts';
import { satisfiesMinShellVersion } from './version.ts';

export const STAMP_FILENAME = 'ui-bundle.json';
const STATE_FILENAME = 'current.json';
export const STAGING_PREFIX = '.staging-';

export interface UiStoreState {
  /** Revision of the activated bundle; null means "serve the shipped floor". */
  readonly revision: number | null;
  /**
   * True between activating a bundle and the renderer confirming it booted.
   * A bundle still pending when the next check runs never got to signal ready,
   * so it is quarantined rather than retried forever.
   */
  readonly pendingVerify: boolean;
  /** Revisions that failed to boot and must never be activated again. */
  readonly quarantined: readonly number[];
}

const EMPTY_STATE: UiStoreState = { revision: null, pendingVerify: false, quarantined: [] };

export interface UiBundleStoreOptions {
  /** Directory holding bundles and state, normally `userData/ui`. */
  readonly rootDir: string;
  /**
   * The UI the app shipped with (`resources/client`). Immutable: on macOS it
   * lives inside the signed, notarized .app, so writing there breaks the
   * signature. It is the offline floor and is never quarantined.
   */
  readonly shippedDir: string;
  /** `app.getVersion()`, for the minShellVersion gate. */
  readonly shellVersion: string;
  readonly log: (message: string, error?: unknown) => void;
}

export interface UiBundleStore {
  /** Cheap enough to call per HTTP request; the result is memoised. */
  resolveActiveDir: () => string;
  activeRevision: () => number | null;
  shippedStamp: () => UiBundleStamp;
  readState: () => UiStoreState;
  bundleDir: (revision: number) => string;
  stagingDir: (revision: number) => string;
  /** Points the store at a freshly extracted bundle, pending boot confirmation. */
  activate: (revision: number) => void;
  /** Renderer booted successfully on the active bundle. */
  confirmActive: () => void;
  /** Bundle failed to boot: blocklist it and fall back to the shipped floor. */
  quarantine: (revision: number) => void;
  /** Kill switch: drop the active bundle and serve the shipped floor. */
  revertToShipped: () => void;
  /** Deletes staging leftovers and all but the active + previous bundle. */
  prune: () => void;
}

function readJsonFile(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function parseState(value: unknown): UiStoreState {
  if (typeof value !== 'object' || value === null) return EMPTY_STATE;
  const raw = value as Record<string, unknown>;
  const revision =
    typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision > 0
      ? raw.revision
      : null;
  const quarantined = Array.isArray(raw.quarantined)
    ? raw.quarantined.filter(
        (entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry),
      )
    : [];
  return { revision, pendingVerify: raw.pendingVerify === true, quarantined };
}

export function createUiBundleStore(options: UiBundleStoreOptions): UiBundleStore {
  const { rootDir, shippedDir, shellVersion, log } = options;

  const statePath = join(rootDir, STATE_FILENAME);
  let cachedActiveDir: string | null = null;
  let cachedShippedStamp: UiBundleStamp | null = null;

  function bundleDir(revision: number): string {
    return join(rootDir, String(revision));
  }

  function stagingDir(revision: number): string {
    return join(rootDir, `${STAGING_PREFIX}${revision}`);
  }

  function readStamp(dir: string): UiBundleStamp | null {
    return parseUiBundleStamp(readJsonFile(join(dir, STAMP_FILENAME)));
  }

  function shippedStamp(): UiBundleStamp {
    if (cachedShippedStamp) return cachedShippedStamp;
    // A missing stamp means a build that predates this feature, or a local dev
    // build. Treat it as revision 0 so any published bundle outranks it.
    cachedShippedStamp = readStamp(shippedDir) ?? {
      revision: 0,
      label: 'shipped',
      minShellVersion: '0.0.0',
    };
    return cachedShippedStamp;
  }

  function readState(): UiStoreState {
    return parseState(readJsonFile(statePath));
  }

  function writeState(next: UiStoreState): void {
    try {
      if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true });
      writeFileSync(statePath, JSON.stringify(next), 'utf8');
    } catch (error) {
      log('ui-update: failed to persist bundle state', error);
    }
    cachedActiveDir = null;
  }

  /**
   * Decides which directory the local server should serve. Every rejection path
   * lands on the shipped floor, so a broken or untrusted bundle degrades to the
   * UI the app was built with rather than to a blank window.
   */
  function computeActiveDir(): string {
    const state = readState();
    if (state.revision === null) return shippedDir;
    if (state.quarantined.includes(state.revision)) return shippedDir;

    const dir = bundleDir(state.revision);
    const stamp = readStamp(dir);
    if (!stamp) {
      log(`ui-update: bundle ${state.revision} is missing its stamp; using shipped UI`);
      return shippedDir;
    }
    if (!satisfiesMinShellVersion(shellVersion, stamp.minShellVersion)) {
      log(
        `ui-update: bundle ${stamp.revision} needs shell >= ${stamp.minShellVersion} (have ${shellVersion}); using shipped UI`,
      );
      return shippedDir;
    }
    // After an app upgrade the shipped UI can be newer than what was downloaded
    // before it. The floor wins ties so a fresh install never regresses.
    if (stamp.revision <= shippedStamp().revision) return shippedDir;

    return dir;
  }

  return {
    resolveActiveDir() {
      if (cachedActiveDir === null) cachedActiveDir = computeActiveDir();
      return cachedActiveDir;
    },

    activeRevision() {
      const state = readState();
      return state.revision;
    },

    shippedStamp,
    readState,
    bundleDir,
    stagingDir,

    activate(revision) {
      const state = readState();
      writeState({
        revision,
        pendingVerify: true,
        quarantined: state.quarantined,
      });
    },

    confirmActive() {
      const state = readState();
      if (!state.pendingVerify) return;
      writeState({ ...state, pendingVerify: false });
    },

    quarantine(revision) {
      const state = readState();
      const quarantined = state.quarantined.includes(revision)
        ? state.quarantined
        : [...state.quarantined, revision];
      log(`ui-update: quarantining bundle ${revision}; reverting to shipped UI`);
      writeState({ revision: null, pendingVerify: false, quarantined });
    },

    revertToShipped() {
      const state = readState();
      if (state.revision === null && !state.pendingVerify) return;
      writeState({ revision: null, pendingVerify: false, quarantined: state.quarantined });
    },

    prune() {
      try {
        if (!existsSync(rootDir)) return;
        const active = readState().revision;
        const revisions = readdirSync(rootDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);

        const numeric = revisions
          .filter((name) => /^\d+$/.test(name))
          .map(Number)
          .sort((a, b) => b - a);

        // Keep the active bundle plus the newest other one, so a quarantine has
        // something recent to fall back to without re-downloading.
        const keep = new Set<number>();
        if (active !== null) keep.add(active);
        for (const revision of numeric) {
          if (keep.size >= 2) break;
          keep.add(revision);
        }

        for (const name of revisions) {
          const isStaging = name.startsWith(STAGING_PREFIX);
          const isKept = /^\d+$/.test(name) && keep.has(Number(name));
          if (isStaging || (!isKept && /^\d+$/.test(name))) {
            rmSync(join(rootDir, name), { recursive: true, force: true });
          }
        }
      } catch (error) {
        log('ui-update: prune failed', error);
      }
    },
  };
}
