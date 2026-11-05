import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import { BrowserWindow, shell } from 'electron';
import { resolveNavigationAction, shouldOpenWindowExternally } from './desktop-navigation.ts';
import { installDesktopForceReloadShortcut } from './desktop-reload.ts';
import { installDesktopPageZoomShortcuts } from './desktop-zoom.ts';
import { loadWithRetry } from './window-loader.ts';

export function createDesktopWindow(targetUrl: string, onClosed: () => void): BrowserWindow {
  const isMac = process.platform === 'darwin';

  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#041f1d',
    // Frameless on macOS removes the traffic-light window controls; drag regions
    // in the renderer topbar replace the native title bar for moving the window.
    ...(isMac ? { frame: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The preload only uses sandbox-safe modules (contextBridge, ipcRenderer, webFrame).
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
    if (is.dev) window.webContents.openDevTools({ mode: 'right' });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenWindowExternally(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const guardNavigation = (event: Electron.Event, url: string) => {
    const action = resolveNavigationAction(targetUrl, url);
    if (action === 'allow') return;
    event.preventDefault();
    if (action === 'open-externally') void shell.openExternal(url);
  };
  window.webContents.on('will-navigate', guardNavigation);
  // Server-side redirects skip will-navigate; apply the same policy to them.
  window.webContents.on('will-redirect', guardNavigation);

  // View-menu accelerators are not reliable across platforms and keyboard
  // layouts. Handle the actual key input at the window boundary as a fallback.
  installDesktopForceReloadShortcut(window.webContents);
  installDesktopPageZoomShortcuts(window.webContents);

  // View-menu / shortcut zoom does not reliably fire DOM `resize`; forward the
  // factor so the renderer can keep the page-zoom indicator in sync.
  window.webContents.on('zoom-changed', () => {
    window.webContents.send('agendex:page-zoom', window.webContents.getZoomFactor());
  });

  window.on('closed', onClosed);
  loadWithRetry(window, targetUrl);

  return window;
}
