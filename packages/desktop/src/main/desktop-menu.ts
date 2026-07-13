import { Menu } from 'electron';

export interface BuildMenuOptions {
  /** Shown as "Check for Updates…" when the build supports self-update. */
  onCheckForUpdates?: () => void;
}

export function buildMenu(options: BuildMenuOptions = {}): void {
  const isMac = process.platform === 'darwin';
  const { onCheckForUpdates } = options;

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
    { role: 'viewMenu' },
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
