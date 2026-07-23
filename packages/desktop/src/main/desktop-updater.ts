// Auto-update orchestration for the packaged desktop app.
//
// Uses electron-updater's generic provider pointed at the GitHub "latest
// release" download alias (see electron-builder.yml `publish`). Updates are
// downloaded in the background; the user is prompted to restart once a
// download completes, and any downloaded update is also installed on quit.
//
// The electron-updater instance is injected so the scheduling/prompt logic is
// testable without Electron.

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_INITIAL_DELAY_MS = 10_000;

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  // Method shorthand keeps this bivariant so electron-updater's AppUpdater
  // (whose `on` is keyed by AppUpdaterEvents) is assignable without casts.
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface UpdatePromptResult {
  restartNow: boolean;
}

/** Narrow scheduling shape so tests can inject fakes without matching Node's full setTimeout/setInterval types. */
export type ScheduleFn = (callback: () => void, ms: number) => { unref?: () => unknown };

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'no-update' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  error?: string;
}

export interface DesktopUpdaterOptions {
  updater: UpdaterLike;
  /** Auto-update only works for packaged, signed builds. */
  isPackaged: boolean;
  /** Prompt the user after an update downloaded; resolve restartNow=true to install immediately. */
  promptToRestart: (info: { version: string }) => Promise<UpdatePromptResult>;
  /** Notify the user after an explicit (menu-triggered) check found nothing. */
  notifyUpToDate?: (info: { version: string }) => void;
  /** Called whenever the update state transitions. */
  onStateChange?: (state: UpdateState) => void;
  log: (message: string, error?: unknown) => void;
  checkIntervalMs?: number;
  initialDelayMs?: number;
  setIntervalFn?: ScheduleFn;
  setTimeoutFn?: ScheduleFn;
}

export interface DesktopUpdater {
  /** Begin background checks (initial delayed check + periodic re-checks). No-op when not packaged. */
  start: () => void;
  /** User-initiated check (e.g. from the app menu). Reports "up to date" via notifyUpToDate. */
  checkForUpdatesInteractive: () => Promise<void>;
  /** User-initiated check without the "up to date" dialog (e.g. from the renderer). */
  checkForUpdates: () => Promise<void>;
  /** Install a downloaded update and restart. */
  quitAndInstall: () => void;
  /** Current update state. */
  getState: () => UpdateState;
  /** True when the app cannot self-update (dev/unpackaged build). */
  isSupported: boolean;
}

interface UpdateDownloadedEvent {
  version?: string;
}

interface UpdateInfoEvent {
  version?: string;
}

interface ProgressInfoEvent {
  percent?: number;
}

export function createDesktopUpdater(options: DesktopUpdaterOptions): DesktopUpdater {
  const {
    updater,
    isPackaged,
    promptToRestart,
    notifyUpToDate,
    onStateChange,
    log,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
  } = options;

  let started = false;
  let interactiveCheckPending = false;
  let restartPromptShown = false;
  let state: UpdateState = { status: 'idle' };

  function setState(next: UpdateState) {
    state = next;
    onStateChange?.(next);
  }

  if (isPackaged) {
    updater.autoDownload = true;
    // Even if the user picks "Later", the downloaded update installs on quit.
    updater.autoInstallOnAppQuit = true;

    updater.on('error', ((error: unknown) => {
      // Update failures must never take the app down; log and retry next cycle.
      log('auto-update error', error);
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }) as never);

    updater.on('checking-for-update', (() => {
      setState({ status: 'checking' });
    }) as never);

    updater.on('update-available', ((info: UpdateInfoEvent) => {
      setState({ status: 'downloading', version: info?.version });
    }) as never);

    updater.on('update-not-available', (() => {
      setState({ status: 'no-update' });
    }) as never);

    updater.on('download-progress', ((info: ProgressInfoEvent) => {
      setState({
        status: 'downloading',
        version: state.version,
        progress: info?.percent,
      });
    }) as never);

    updater.on('update-downloaded', ((event: UpdateDownloadedEvent) => {
      setState({ status: 'ready', version: event?.version ?? 'unknown' });
      if (restartPromptShown) return;
      restartPromptShown = true;
      const version = event?.version ?? 'unknown';
      void promptToRestart({ version })
        .then((result) => {
          if (result.restartNow) updater.quitAndInstall();
          else restartPromptShown = false;
        })
        .catch((error) => {
          restartPromptShown = false;
          log('auto-update restart prompt failed', error);
        });
    }) as never);
  }

  async function checkSafely(): Promise<unknown> {
    try {
      return await updater.checkForUpdates();
    } catch (error) {
      log('auto-update check failed', error);
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  return {
    isSupported: isPackaged,

    start() {
      if (!isPackaged || started) return;
      started = true;

      const timer = setTimeoutFn(() => {
        void checkSafely();
      }, initialDelayMs);
      timer.unref?.();

      const interval = setIntervalFn(() => {
        void checkSafely();
      }, checkIntervalMs);
      interval.unref?.();
    },

    async checkForUpdatesInteractive() {
      if (!isPackaged || interactiveCheckPending) return;
      interactiveCheckPending = true;
      try {
        const result = (await checkSafely()) as {
          updateInfo?: { version?: string };
          isUpdateAvailable?: boolean;
        } | null;

        // electron-updater resolves with isUpdateAvailable=false when current.
        // A downloaded update triggers the 'update-downloaded' prompt instead.
        if (result && result.isUpdateAvailable === false) {
          notifyUpToDate?.({ version: result.updateInfo?.version ?? 'current' });
        }
      } finally {
        interactiveCheckPending = false;
      }
    },

    async checkForUpdates() {
      if (!isPackaged || interactiveCheckPending) return;
      interactiveCheckPending = true;
      try {
        await checkSafely();
      } finally {
        interactiveCheckPending = false;
      }
    },

    quitAndInstall() {
      if (!isPackaged || state.status !== 'ready') return;
      updater.quitAndInstall();
    },

    getState() {
      return state;
    },
  };
}
