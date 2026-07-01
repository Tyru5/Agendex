import type { BrowserWindow } from 'electron';

export function loadWithRetry(window: BrowserWindow, url: string, attemptsLeft = 20): void {
  window.loadURL(url).catch(() => undefined);

  const onFail = (): void => {
    if (attemptsLeft <= 0) return;
    setTimeout(() => {
      if (!window.isDestroyed()) loadWithRetry(window, url, attemptsLeft - 1);
    }, 300);
  };

  window.webContents.once('did-fail-load', onFail);
  window.webContents.once('did-finish-load', () => {
    window.webContents.removeListener('did-fail-load', onFail);
  });
}
