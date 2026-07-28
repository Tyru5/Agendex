// Quit orchestration for the desktop app.
//
// Quitting has to stop the in-process backend and the sync daemon before
// Electron tears the runtime down, but none of that cleanup may stand between
// the user and an exit: a quit that stalls shows up as a "not responding" app
// the user has to force-kill.

const DEFAULT_FORCE_EXIT_TIMEOUT_MS = 5_000;

export interface DesktopQuitEvent {
  preventDefault: () => void;
}

export interface DesktopQuitApp {
  on: (event: 'before-quit', listener: (event: DesktopQuitEvent) => void) => unknown;
  quit: () => void;
  exit: (code?: number) => void;
}

/** Narrow scheduling shape so tests can inject fakes without matching Node's setTimeout type. */
export type QuitScheduleFn = (callback: () => void, ms: number) => { unref?: () => unknown };

export interface DesktopQuitLifecycleOptions {
  app: DesktopQuitApp;
  /** Best-effort service cleanup. Expected to resolve within its own deadlines. */
  shutdownServices: () => Promise<void>;
  forceExitTimeoutMs?: number;
  setTimeoutFn?: QuitScheduleFn;
  log?: (message: string, error?: unknown) => void;
}

export function installDesktopQuitLifecycle(options: DesktopQuitLifecycleOptions): void {
  const forceExitTimeoutMs = options.forceExitTimeoutMs ?? DEFAULT_FORCE_EXIT_TIMEOUT_MS;
  const schedule = options.setTimeoutFn ?? setTimeout;
  let shutdownStarted = false;
  let readyToQuit = false;

  options.app.on('before-quit', (event) => {
    if (readyToQuit) return;
    // Hold the quit open for one round of service cleanup. Repeat quit requests
    // join the in-flight shutdown instead of starting a second one.
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;

    void options
      .shutdownServices()
      .catch((error: unknown) => {
        options.log?.('failed to stop desktop services during quit', error);
      })
      .finally(() => {
        readyToQuit = true;
        options.app.quit();

        // Last resort for a quit that Electron itself cannot finish (a window
        // that refuses to close, a wedged child process). Never reached when
        // the quit above completes, because the process is already gone.
        const forceExit = schedule(() => {
          options.log?.('quit did not complete in time, forcing exit');
          options.app.exit(0);
        }, forceExitTimeoutMs);
        forceExit.unref?.();
      });
  });
}
