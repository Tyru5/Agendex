const DEFAULT_SERVER_CLOSE_TIMEOUT_MS = 3_000;

export interface DesktopShutdownWindow {
  isDestroyed: () => boolean;
  destroy: () => void;
}

export interface StopDesktopServicesOptions {
  window: DesktopShutdownWindow | null;
  stopDaemon: () => Promise<void>;
  closeServer?: () => Promise<void>;
  serverCloseTimeoutMs?: number;
}

function closeServerWithDeadline(
  closeServer: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
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
    void Promise.resolve().then(closeServer).then(finish, finish);
  });
}

export async function stopDesktopServices(options: StopDesktopServicesOptions): Promise<void> {
  // Destroying the renderer first closes its upgraded WebSocket connection.
  // The deadline is a final guard for any other socket that outlives the window.
  if (options.window && !options.window.isDestroyed()) {
    options.window.destroy();
  }

  const shutdowns: Promise<void>[] = [options.stopDaemon()];
  if (options.closeServer) {
    shutdowns.push(
      closeServerWithDeadline(
        options.closeServer,
        options.serverCloseTimeoutMs ?? DEFAULT_SERVER_CLOSE_TIMEOUT_MS,
      ),
    );
  }
  await Promise.allSettled(shutdowns);
}
