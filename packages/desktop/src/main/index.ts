import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startNodeServer, type RunningNodeServer } from '@agendex/app/server';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import {
  clearCloudCreds,
  getSiteUrl,
  loadCloudCreds,
  refreshCloudSession,
  runLoopbackLogin,
  saveCloudCreds,
} from './cloud-auth.ts';

const DEV_SERVER_PORT = 4890;
const DEV_RENDERER_URL = 'http://app.agendex.localhost:5174/dashboard';

type DashboardMode = 'local' | 'cloud';

function modePrefPath(): string {
  return join(app.getPath('userData'), 'agendex-dashboard-mode.json');
}

function loadModePref(): DashboardMode | null {
  try {
    const path = modePrefPath();
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { mode?: string };
    return raw.mode === 'local' || raw.mode === 'cloud' ? raw.mode : null;
  } catch {
    return null;
  }
}

function saveModePref(mode: DashboardMode): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(modePrefPath(), JSON.stringify({ mode }), 'utf8');
}

let mainWindow: BrowserWindow | null = null;
let server: RunningNodeServer | null = null;
let localApiToken = '';
let rendererTargetUrl = '';
let backendBoot: Promise<void> | null = null;

function resolveClientDistDir(): string {
  if (app.isPackaged) {
    // electron-builder copies the built EE client to resources/client (see electron-builder.yml).
    return join(process.resourcesPath, 'client');
  }
  // Dev/unpackaged prod-serve: out/main -> packages/ee/dist
  return join(__dirname, '../../../ee/dist');
}

/** Loads a URL, retrying on transient failures (dev Vite/HTTP server warming up). */
function loadWithRetry(window: BrowserWindow, url: string, attemptsLeft = 20) {
  window.loadURL(url).catch(() => {
    /* did-fail-load handles retry */
  });

  const onFail = () => {
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

function createWindow(targetUrl: string) {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
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

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadWithRetry(mainWindow, targetUrl);
}

async function ensureBackend() {
  if (server) return;
  if (backendBoot) {
    await backendBoot;
    return;
  }

  backendBoot = (async () => {
    const clientDistDir = resolveClientDistDir();

    if (is.dev) {
      // Renderer HMR: API on the fixed port the EE client's dev proxy + WS expect,
      // window points at the EE Vite dev server.
      server = await startNodeServer({ port: DEV_SERVER_PORT, clientDistDir });
      localApiToken = server.token;
      rendererTargetUrl = process.env.AGENDEX_RENDERER_URL ?? DEV_RENDERER_URL;
    } else {
      // Prod: ephemeral port on `localhost` (a cloud-trusted origin so better-auth
      // CORS accepts the desktop), client + local API served from the same origin.
      server = await startNodeServer({ port: 0, clientDistDir, hostname: 'localhost' });
      localApiToken = server.token;
      rendererTargetUrl = `http://localhost:${server.port}/dashboard`;
    }
  })();

  try {
    await backendBoot;
  } finally {
    backendBoot = null;
  }
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  createWindow(rendererTargetUrl);
}

async function startBackendAndWindow() {
  await ensureBackend();
  showMainWindow();
}

function registerIpc() {
  // Synchronous bootstrap so the preload can seed tokens before page scripts run.
  ipcMain.on('agendex:get-bootstrap', (event) => {
    const cloud = loadCloudCreds();
    event.returnValue = {
      localToken: localApiToken,
      cloudToken: cloud?.token ?? null,
      convexSiteUrl: cloud?.convexSiteUrl ?? null,
      modePref: loadModePref(),
    };
  });

  ipcMain.handle('agendex:set-mode-pref', (_event, mode: unknown) => {
    if (mode !== 'local' && mode !== 'cloud') return false;
    saveModePref(mode);
    return true;
  });

  ipcMain.handle('agendex:refresh-cloud-session', async () => refreshCloudSession());

  ipcMain.handle('agendex:login', async () => {
    try {
      const creds = await runLoopbackLogin(getSiteUrl(is.dev));
      saveCloudCreds(creds);
      return true;
    } catch (err) {
      console.error('[agendex-desktop] cloud login failed', err);
      return false;
    }
  });

  ipcMain.handle('agendex:logout', () => {
    clearCloudCreds();
    return true;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      return;
    }

    void startBackendAndWindow().catch((err) => {
      console.error('[agendex-desktop] failed to reopen window from second instance', err);
      app.quit();
    });
  });

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('dev.agendex.desktop');

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    registerIpc();
    buildMenu();

    void refreshCloudSession()
      .then(() => startBackendAndWindow())
      .catch((err) => {
        console.error('[agendex-desktop] failed to start backend', err);
        app.quit();
      });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void startBackendAndWindow().catch((err) => {
          console.error('[agendex-desktop] failed to reopen window', err);
          app.quit();
        });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void server?.close();
    server = null;
  });
}
