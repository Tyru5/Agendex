import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import { BrowserWindow, shell } from 'electron';
import {
  shouldOpenNavigationExternally,
  shouldOpenWindowExternally,
} from './desktop-navigation.ts';
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
      sandbox: false,
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

  window.webContents.on('will-navigate', (event, url) => {
    if (!shouldOpenNavigationExternally(targetUrl, url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  window.on('closed', onClosed);
  loadWithRetry(window, targetUrl);

  return window;
}
