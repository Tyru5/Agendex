// Remote UI bundle updates for the packaged desktop app.
//
// The renderer is served by the in-process Node server from a directory on
// disk, so shipping a UI change does not require a new Electron build: publish
// a signed bundle, and installed shells download it into userData and serve
// that instead. `resources/client` stays as the immutable offline floor.
//
// Deliberately mirrors createDesktopUpdater's dependency-injected shape so the
// scheduling and prompt logic is testable without Electron. One difference:
// this does *not* opt out of Windows portable builds. They cannot replace the
// app in place, but userData is still writable, so they can take UI updates.

import type { ScheduleFn } from './desktop-updater.ts';
import { fetchSignedManifest } from './ui-bundle/manifest.ts';
import { installBundle } from './ui-bundle/install.ts';
import type { UiBundleStore } from './ui-bundle/store.ts';
import type { FetchLike, UiManifest, UiUpdateState } from './ui-bundle/types.ts';
import { satisfiesMinShellVersion } from './ui-bundle/version.ts';

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_INITIAL_DELAY_MS = 15_000;
/**
 * How long a freshly activated bundle has to report that it rendered. Generous:
 * a slow cold start on a loaded machine must not look like a broken bundle.
 */
const DEFAULT_BOOT_SENTINEL_MS = 20_000;

export interface UiReloadPromptResult {
  reloadNow: boolean;
}

export interface UiUpdaterOptions {
  readonly store: UiBundleStore;
  /** Directory holding bundles, normally `userData/ui`. */
  readonly rootDir: string;
  readonly feedUrl: string;
  readonly publicKeyPem: string;
  readonly shellVersion: string;
  readonly fetchImpl: FetchLike;
  readonly isPackaged: boolean;
  /** False when explicitly disabled or no signing key is baked in. */
  readonly enabled: boolean;
  readonly promptToReload: (info: {
    revision: number;
    label: string;
  }) => Promise<UiReloadPromptResult>;
  /** Reloads the main window onto whatever the store now resolves to. */
  readonly applyReload: () => void;
  readonly onStateChange?: (state: UiUpdateState) => void;
  readonly log: (message: string, error?: unknown) => void;
  readonly checkIntervalMs?: number;
  readonly initialDelayMs?: number;
  readonly bootSentinelMs?: number;
  readonly setIntervalFn?: ScheduleFn;
  readonly setTimeoutFn?: ScheduleFn;
  readonly now?: () => number;
}

export interface UiUpdater {
  /** Background checks. No-op when unsupported. */
  start: () => void;
  /** User-initiated check. */
  checkForUpdates: () => Promise<void>;
  /** Activate the staged bundle and reload the window. */
  applyStaged: () => void;
  getState: () => UiUpdateState;
  /**
   * Called at boot, before the server starts serving. A bundle still marked
   * pending means the previous run activated it and the renderer never came up
   * — the app was killed, or the bundle threw on load. Quarantine it.
   */
  reconcilePendingVerify: () => void;
  /** The renderer mounted successfully on the active bundle. */
  notifyRendererReady: () => void;
  /** The window failed to load; treat the active bundle as broken. */
  notifyLoadFailure: () => void;
  readonly isSupported: boolean;
}

export function createUiUpdater(options: UiUpdaterOptions): UiUpdater {
  const {
    store,
    rootDir,
    feedUrl,
    publicKeyPem,
    shellVersion,
    fetchImpl,
    isPackaged,
    enabled,
    promptToReload,
    applyReload,
    onStateChange,
    log,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    bootSentinelMs = DEFAULT_BOOT_SENTINEL_MS,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
    now = Date.now,
  } = options;

  const supported = isPackaged && enabled;

  let started = false;
  let checkPending = false;
  let promptShown = false;
  let staged: UiManifest | null = null;
  let awaitingBootConfirmation = false;
  let state: UiUpdateState = supported ? { status: 'idle' } : { status: 'unsupported' };

  function setState(next: UiUpdateState) {
    state = next;
    onStateChange?.(next);
  }

  function shouldInstall(manifest: UiManifest): boolean {
    if (store.readState().quarantined.includes(manifest.revision)) {
      log(`ui-update: bundle ${manifest.revision} is quarantined; ignoring`);
      return false;
    }
    if (!satisfiesMinShellVersion(shellVersion, manifest.minShellVersion)) {
      log(
        `ui-update: bundle ${manifest.revision} needs shell >= ${manifest.minShellVersion} (have ${shellVersion})`,
      );
      return false;
    }
    // The manifest is desired state, not "newer only": republishing an older
    // revision is the rollback path. Only skip when it matches what we serve.
    return manifest.revision !== store.servedRevision();
  }

  async function runCheck(): Promise<void> {
    if (!supported) return;
    setState({ status: 'checking' });

    const manifest = await fetchSignedManifest({
      feedUrl,
      publicKeyPem,
      fetchImpl,
      log,
      now,
    });

    if (!manifest) {
      setState({ status: 'error', error: 'Could not verify the update feed.' });
      return;
    }

    if (manifest.pinToShipped) {
      // Emergency lever: the published UI is broken and everyone should fall
      // back to what they shipped with. Do not wait for a prompt — the floor is
      // known-good, so reloading onto it is a rescue, not an interruption.
      log('ui-update: feed is pinned to the shipped UI; reverting');
      const wasOverridden = store.readState().revision !== null;
      store.revertToShipped();
      store.prune();
      staged = null;
      setState({ status: 'no-update' });
      if (wasOverridden) applyReload();
      return;
    }

    // The shipped UI already outranks the feed — the normal state right after an
    // app update, whose bundled client is newer than the last UI publish. The
    // store refuses to serve a bundle that does not beat the shipped floor (see
    // computeActiveDir), so treating this as an update would download it, prompt,
    // activate it, and reload onto the very same UI — on every check, forever.
    const shipped = store.shippedStamp().revision;
    if (manifest.revision <= shipped) {
      log(
        `ui-update: feed revision ${manifest.revision} does not beat the shipped UI (${shipped}); staying on shipped`,
      );
      // An activation left over from before the app update can never pass the
      // floor gate again. Clear it so the persisted state matches what is on
      // screen; no reload, because the window is already serving the floor.
      store.revertToShipped();
      staged = null;
      setState({ status: 'no-update' });
      return;
    }

    if (!shouldInstall(manifest)) {
      setState({ status: 'no-update' });
      return;
    }

    setState({ status: 'downloading', revision: manifest.revision, label: manifest.label });

    try {
      await installBundle({
        manifest,
        store,
        rootDir,
        fetchImpl,
        log,
        onProgress: (progress) =>
          setState({
            status: 'downloading',
            revision: manifest.revision,
            label: manifest.label,
            progress,
          }),
      });
    } catch (error) {
      log('ui-update: install failed', error);
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    staged = manifest;
    setState({ status: 'ready', revision: manifest.revision, label: manifest.label });

    if (promptShown) return;
    promptShown = true;
    try {
      const result = await promptToReload({ revision: manifest.revision, label: manifest.label });
      if (result.reloadNow) applyStaged();
      else promptShown = false;
    } catch (error) {
      promptShown = false;
      log('ui-update: reload prompt failed', error);
    }
  }

  function applyStaged(): void {
    if (!staged) return;
    const { revision } = staged;
    store.activate(revision);
    staged = null;
    promptShown = false;
    awaitingBootConfirmation = true;

    // If the new bundle never reports that it rendered, assume it is broken and
    // fall back. Without this a bad publish would leave every user staring at a
    // blank window with no way back.
    const sentinel = setTimeoutFn(() => {
      if (!awaitingBootConfirmation) return;
      awaitingBootConfirmation = false;
      store.quarantine(revision);
      setState({ status: 'error', error: 'The updated UI failed to start; reverted.' });
      applyReload();
    }, bootSentinelMs);
    sentinel.unref?.();

    setState({ status: 'idle' });
    applyReload();
  }

  return {
    isSupported: supported,

    start() {
      if (!supported || started) return;
      started = true;
      store.prune();

      const initial = setTimeoutFn(() => {
        void runCheck();
      }, initialDelayMs);
      initial.unref?.();

      const interval = setIntervalFn(() => {
        void runCheck();
      }, checkIntervalMs);
      interval.unref?.();
    },

    async checkForUpdates() {
      if (!supported || checkPending) return;
      checkPending = true;
      try {
        await runCheck();
      } finally {
        checkPending = false;
      }
    },

    applyStaged,

    getState() {
      return state;
    },

    reconcilePendingVerify() {
      const { revision, pendingVerify } = store.readState();
      if (!pendingVerify || revision === null) return;
      log(`ui-update: bundle ${revision} never confirmed a successful boot`);
      store.quarantine(revision);
    },

    notifyRendererReady() {
      awaitingBootConfirmation = false;
      store.confirmActive();
    },

    notifyLoadFailure() {
      if (!awaitingBootConfirmation) return;
      const { revision } = store.readState();
      if (revision === null) return;
      awaitingBootConfirmation = false;
      store.quarantine(revision);
      setState({ status: 'error', error: 'The updated UI failed to load; reverted.' });
      applyReload();
    },
  };
}
