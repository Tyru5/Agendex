export interface ForceReloadInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

interface PreventableInputEvent {
  preventDefault(): void;
}

interface ForceReloadWebContents {
  on(
    event: 'before-input-event',
    listener: (event: PreventableInputEvent, input: ForceReloadInput) => void,
  ): unknown;
  reloadIgnoringCache(): void;
}

export function isForceReloadShortcut(
  input: ForceReloadInput,
  isMac = process.platform === 'darwin',
): boolean {
  const hasPrimaryModifier = isMac ? input.meta && !input.control : input.control && !input.meta;
  return (
    input.type === 'keyDown' &&
    hasPrimaryModifier &&
    input.shift &&
    !input.alt &&
    input.key.toLowerCase() === 'r'
  );
}

export function installDesktopForceReloadShortcut(webContents: ForceReloadWebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (!isForceReloadShortcut(input)) return;

    event.preventDefault();
    webContents.reloadIgnoringCache();
  });
}
