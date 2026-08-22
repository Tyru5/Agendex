import { Menu } from 'electron';
import type { PageZoomShortcut } from './desktop-zoom.ts';

export interface BuildMenuOptions {
  onPageZoom: (shortcut: PageZoomShortcut) => void;
  /** Shown as "Check for Updates…" when the build supports self-update. */
  onCheckForUpdates?: () => void;
}

export function buildMenu(options: BuildMenuOptions): void {
  const isMac = process.platform === 'darwin';
  const { onCheckForUpdates, onPageZoom } = options;

  const updateItems: Electron.MenuItemConstructorOptions[] = onCheckForUpdates
    ? [{ label: 'Check for Updates…', click: () => onCheckForUpdates() }, { type: 'separator' }]
    : [];

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: 'appMenu' as const,
            submenu: [
              { role: 'about' as const },
              ...updateItems,
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CommandOrControl+0',
          click: () => onPageZoom('reset'),
        },
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+Plus',
          click: () => onPageZoom('in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          click: () => onPageZoom('out'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    ...(!isMac && onCheckForUpdates
      ? [
          {
            role: 'help' as const,
            submenu: updateItems.filter((item) => item.type !== 'separator'),
          },
        ]
      : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
