import {
  registerDesktopProtocolClient,
  type DesktopProtocolController,
} from './desktop-protocol.ts';

type PreventableEvent = {
  readonly preventDefault: () => void;
};

export type DesktopProtocolLifecycleApp = {
  readonly isReady: () => boolean;
  readonly on: {
    (event: 'open-url', listener: (event: PreventableEvent, rawUrl: string) => void): void;
    (
      event: 'second-instance',
      listener: (event: unknown, commandLine: readonly string[]) => void,
    ): void;
  };
  readonly setAsDefaultProtocolClient: (
    protocol: string,
    execPath?: string,
    args?: string[],
  ) => boolean;
  readonly whenReady: () => Promise<void>;
};

export type DesktopProtocolProcessInfo = {
  readonly isDefaultApp: boolean;
  readonly execPath: string;
  readonly argv: readonly string[];
};

export type DesktopProtocolLifecycleOptions = {
  readonly app: DesktopProtocolLifecycleApp;
  readonly controller: Pick<
    DesktopProtocolController,
    'enqueueProtocolUrl' | 'handleCommandLine' | 'drainQueuedCallbacks'
  >;
  readonly processInfo: DesktopProtocolProcessInfo;
  readonly startBackendWindowAndDrainProtocolCallbacks: () => Promise<void>;
  readonly reopenFromSecondInstance: () => Promise<void>;
  readonly logError: (message: string, error: unknown) => void;
  readonly quit: () => void;
};

function runWithQuitOnFailure(
  work: () => Promise<void>,
  message: string,
  options: DesktopProtocolLifecycleOptions,
): void {
  void work().catch((error: unknown) => {
    options.logError(message, error);
    options.quit();
  });
}

export function installDesktopProtocolLifecycle(options: DesktopProtocolLifecycleOptions): void {
  const { app, controller } = options;

  app.on('open-url', (event, rawUrl) => {
    event.preventDefault();
    if (!controller.enqueueProtocolUrl(rawUrl)) return;
    if (app.isReady()) {
      runWithQuitOnFailure(
        options.startBackendWindowAndDrainProtocolCallbacks,
        'failed to handle auth callback',
        options,
      );
    }
  });

  controller.handleCommandLine(options.processInfo.argv);

  app.on('second-instance', (_event, commandLine) => {
    if (controller.handleCommandLine(commandLine)) {
      runWithQuitOnFailure(
        options.startBackendWindowAndDrainProtocolCallbacks,
        'failed to handle auth callback from second instance',
        options,
      );
      return;
    }
    runWithQuitOnFailure(
      options.reopenFromSecondInstance,
      'failed to reopen window from second instance',
      options,
    );
  });

  void app
    .whenReady()
    .then(() => {
      registerDesktopProtocolClient({
        ...options.processInfo,
        setAsDefaultProtocolClient: app.setAsDefaultProtocolClient,
      });
    })
    .catch((error: unknown) => {
      options.logError('failed to register protocol client', error);
      options.quit();
    });
}
