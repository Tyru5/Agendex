export type PageZoomShortcut = 'in' | 'out' | 'reset';

export interface PageZoomInput {
  type: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
}

interface PreventableInputEvent {
  preventDefault(): void;
}

interface PageZoomWebContents {
  on(
    event: 'before-input-event',
    listener: (event: PreventableInputEvent, input: PageZoomInput) => void,
  ): unknown;
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  getZoomFactor(): number;
  send(channel: string, factor: number): void;
}

const PAGE_ZOOM_LEVEL_STEP = 0.5;

export function resolvePageZoomShortcut(
  input: PageZoomInput,
  isMac = process.platform === 'darwin',
): PageZoomShortcut | null {
  const hasPrimaryModifier = isMac ? input.meta && !input.control : input.control && !input.meta;
  if (input.type !== 'keyDown' || !hasPrimaryModifier || input.alt) return null;

  if (input.key === '+' || input.key === '=') return 'in';
  if (input.key === '-') return 'out';
  if (input.key === '0') return 'reset';

  return null;
}

export function getNextPageZoomLevel(currentLevel: number, shortcut: PageZoomShortcut): number {
  if (shortcut === 'reset') return 0;

  return currentLevel + (shortcut === 'in' ? PAGE_ZOOM_LEVEL_STEP : -PAGE_ZOOM_LEVEL_STEP);
}

export function applyDesktopPageZoom(
  webContents: PageZoomWebContents,
  shortcut: PageZoomShortcut,
): void {
  webContents.setZoomLevel(getNextPageZoomLevel(webContents.getZoomLevel(), shortcut));
  webContents.send('agendex:page-zoom', webContents.getZoomFactor());
}

export function installDesktopPageZoomShortcuts(webContents: PageZoomWebContents): void {
  webContents.on('before-input-event', (event, input) => {
    const shortcut = resolvePageZoomShortcut(input);
    if (!shortcut) return;

    // Prevent the renderer and menu accelerator from applying the same
    // shortcut a second time on platforms where either one works.
    event.preventDefault();
    applyDesktopPageZoom(webContents, shortcut);
  });
}
