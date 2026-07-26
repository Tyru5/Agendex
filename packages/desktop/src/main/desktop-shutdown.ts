const DEFAULT_SERVICE_STOP_TIMEOUT_MS = 3_000;

export interface DesktopShutdownWindow {
  isDestroyed: () => boolean;
  destroy: () => void;
}

export interface StopDesktopServicesOptions {
  window: DesktopShutdownWindow | null;
  stopDaemon: () => Promise<void>;
  closeServer?: () => Promise<void>;
  daemonStopTimeoutMs?: number;
  serverCloseTimeoutMs?: number;
}

function stopWithDeadline(stopService: () => Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };

    timer = setTimeout(finish, timeoutMs);
    void Promise.resolve().then(stopService).then(finish, finish);
  });
}

export async function stopDesktopServices(options: StopDesktopServicesOptions): Promise<void> {
  // Destroying the renderer first closes its upgraded WebSocket connection.
  // The deadline is a final guard for any other socket that outlives the window.
  if (options.window && !options.window.isDestroyed()) {
    options.window.destroy();
  }

  // Service cleanup is best-effort. Electron must still be allowed to quit if
  // the daemon is starting, waiting on a lifecycle lock, or otherwise wedged.
  const shutdowns: Promise<void>[] = [
    stopWithDeadline(
      options.stopDaemon,
      options.daemonStopTimeoutMs ?? DEFAULT_SERVICE_STOP_TIMEOUT_MS,
    ),
  ];
  if (options.closeServer) {
    shutdowns.push(
      stopWithDeadline(
        options.closeServer,
        options.serverCloseTimeoutMs ?? DEFAULT_SERVICE_STOP_TIMEOUT_MS,
      ),
    );
  }
  await Promise.allSettled(shutdowns);
}
