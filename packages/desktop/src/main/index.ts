import { join } from 'node:path';
import { startNodeServer, type RunningNodeServer } from '@agendex/app/server';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, dialog, ipcMain, utilityProcess } from 'electron';
import { autoUpdater } from 'electron-updater';
import {
  clearCloudCreds,
  type CloudCreds,
  getConvexAuthToken,
  getSiteUrl,
  loadCloudCreds,
  refreshCloudSession,
  saveCloudCreds,
  validateCloudCreds,
} from './cloud-auth.ts';
import {
  clearPendingDesktopAuthLogin,
  completePendingDesktopAuthLogin,
  loadPendingDesktopAuthLogin,
  startDesktopAuthLogin,
} from './cloud-login.ts';
import { loadModePref, saveModePref } from './dashboard-mode.ts';
import { registerDesktopIpc } from './desktop-ipc.ts';
import { buildMenu } from './desktop-menu.ts';
import { createDesktopProtocolController } from './desktop-protocol.ts';
import { writeQaBootstrapEvidence, writeQaStartupEvidence } from './desktop-qa-evidence.ts';
import { createDesktopUpdater } from './desktop-updater.ts';
import { createDesktopWindow } from './desktop-window.ts';
import { redactDesktopAuthCallbackUrl } from '@agendex/shared/desktop-auth-callback';
import { installDesktopProtocolLifecycle } from './desktop-protocol-lifecycle.ts';
import { stopDesktopServices } from './desktop-shutdown.ts';
import { loadWithRetry } from './window-loader.ts';
import { DesktopDaemonManager } from './desktop-daemon-manager.ts';

// Package name is `@agendex/desktop`; without this, Electron labels the
// macOS Keychain item for safeStorage as "@agendex/desktop Safe Storage".
// Set before any safeStorage use so the prompt reads "Agendex Safe Storage".
app.setName('Agendex');
if (process.env.AGENDEX_DESKTOP_QA_USER_DATA_DIR) {
  app.setPath('userData', process.env.AGENDEX_DESKTOP_QA_USER_DATA_DIR);
}

const DEV_SERVER_PORT = 4890;
const DEV_RENDERER_URL = 'http://app.agendex.localhost:5174/dashboard';

let mainWindow: BrowserWindow | null = null;
let server: RunningNodeServer | null = null;
let localApiToken = '';
let rendererTargetUrl = '';
let backendBoot: Promise<void> | null = null;
let quitAfterShutdown = false;
let shutdownPromise: Promise<void> | null = null;
let authSessionGeneration = 0;

function invalidateAuthSession(): void {
  authSessionGeneration += 1;
}

function isAuthSessionGenerationCurrent(generation: number): boolean {
  return generation === authSessionGeneration;
}

function resolveClientDistDir(): string {
  if (app.isPackaged) {
    // electron-builder copies the built EE client to resources/client (see electron-builder.yml).
    return join(process.resourcesPath, 'client');
  }
  // Dev/unpackaged prod-serve: out/main -> packages/ee/dist
  return join(__dirname, '../../../ee/dist');
}

function createWindow(targetUrl: string): void {
  mainWindow = createDesktopWindow(targetUrl, () => {
    mainWindow = null;
  });
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

function reloadMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  loadWithRetry(mainWindow, rendererTargetUrl);
}

const desktopDaemon = new DesktopDaemonManager({
  isDev: is.dev,
  forkWorker: utilityProcess.fork,
  rotateCloudToken: (previousToken, token, accountId) => {
    const current = loadCloudCreds();
    if (!current) return null;
    if (current.token !== previousToken) return current;
    const rotated = { ...current, token, accountId: accountId ?? current.accountId };
    try {
      saveCloudCreds(rotated);
      return rotated;
    } catch (error) {
      console.error('[agendex-desktop] failed to persist rotated cloud token', error);
      return current;
    }
  },
  onAuthExpired: async (failedToken) => {
    if (shutdownPromise) return;
    const authGeneration = authSessionGeneration;
    const current = loadCloudCreds();
    if (!current || current.token !== failedToken) return;
    await desktopDaemon.stop();

    if (shutdownPromise || !isAuthSessionGenerationCurrent(authGeneration)) return;

    const latest = loadCloudCreds();
    if (!latest) return;
    if (latest.token !== failedToken) {
      if (isAuthSessionGenerationCurrent(authGeneration)) await syncDaemonSession(latest);
      return;
    }

    await refreshCloudSession();
    if (!isAuthSessionGenerationCurrent(authGeneration)) return;
    const revalidated = loadCloudCreds();
    if (revalidated) await syncDaemonSession(revalidated);
    else reloadMainWindow();
  },
  log: (message, error) => {
    if (error === undefined) console.error(`[agendex-desktop] ${message}`);
    else console.error(`[agendex-desktop] ${message}`, error);
  },
  onStateChange: (state) => {
    mainWindow?.webContents.send('agendex:update:state', state);
  },
});

ipcMain.handle('agendex:update:check', () => desktopUpdater.checkForUpdates());
ipcMain.handle('agendex:update:install', () => desktopUpdater.quitAndInstall());
ipcMain.handle('agendex:get-app-version', () => app.getVersion());

const desktopUpdater = createDesktopUpdater({
  // electron-updater is CJS-only and ships no `default` export; import the
  // named `autoUpdater` binding so bundler interop can't yield `undefined`.
  updater: autoUpdater,
  isPackaged: app.isPackaged,
  promptToRestart: async ({ version }) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Agendex ${version} has been downloaded.`,
      detail: 'Restart now to apply the update, or it will install the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    return { restartNow: response === 0 };
  },
  notifyUpToDate: ({ version }) => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'No Updates',
      message: `You're up to date.`,
      detail: `Agendex ${version} is the latest version.`,
      buttons: ['OK'],
    });
  },
  log: (message, error) => {
    if (error === undefined) console.error(`[agendex-desktop] ${message}`);
    else console.error(`[agendex-desktop] ${message}`, error);
  },
});

async function syncDaemonSession(creds: CloudCreds): Promise<void> {
  try {
    await desktopDaemon.ensureRunning(creds);
  } catch (error) {
    console.error('[agendex-desktop] failed to start sync daemon', error);
  }
}

async function shutdownDesktopServices(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  const window = mainWindow;
  const runningServer = server;
  mainWindow = null;
  server = null;
  let resolveShutdown: (() => void) | undefined;
  shutdownPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  void stopDesktopServices({
    window,
    stopDaemon: () => desktopDaemon.stop(),
    ...(runningServer && { closeServer: () => runningServer.close() }),
  }).then(resolveShutdown, resolveShutdown);
  return shutdownPromise;
}

const desktopProtocol = createDesktopProtocolController({
  loadPendingLogin: loadPendingDesktopAuthLogin,
  completePendingLogin: completePendingDesktopAuthLogin,
  validateCloudCreds: async (creds) => {
    const authGeneration = authSessionGeneration;
    writeQaStartupEvidence({
      event: 'desktop-auth-callback-validate-start',
      convexSiteUrl: creds.convexSiteUrl,
      tokenPresent: Boolean(creds.token),
    });
    const validated = await validateCloudCreds(creds);
    if (!isAuthSessionGenerationCurrent(authGeneration)) return null;
    writeQaStartupEvidence({
      event: 'desktop-auth-callback-validate-result',
      ok: Boolean(validated),
      convexSiteUrl: validated?.convexSiteUrl ?? null,
      tokenPresent: Boolean(validated?.token),
    });
    return validated;
  },
  saveCloudCreds: (creds) => {
    writeQaStartupEvidence({
      event: 'desktop-auth-callback-save-start',
      convexSiteUrl: creds.convexSiteUrl,
      tokenPresent: Boolean(creds.token),
    });
    saveCloudCreds(creds);
    writeQaStartupEvidence({
      event: 'desktop-auth-callback-save-complete',
      convexSiteUrl: creds.convexSiteUrl,
      tokenPresent: Boolean(creds.token),
    });
  },
  getWindowState: () => ({
    hasWindow: Boolean(mainWindow),
    isDestroyed: mainWindow?.isDestroyed() ?? true,
  }),
  reloadDashboardWindow: reloadMainWindow,
  focusDashboardWindow: showMainWindow,
  createDashboardWindow: showMainWindow,
  log: (message) => {
    console.warn('[agendex-desktop] desktop auth callback', message);
    writeQaStartupEvidence({ event: 'desktop-auth-callback-log', message });
  },
});

async function startBackendWindowAndDrainProtocolCallbacks() {
  await startBackendAndWindow();
  await desktopProtocol.drainQueuedCallbacks();
}

async function reopenFromSecondInstance() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  await startBackendAndWindow();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  writeQaStartupEvidence({
    event: 'startup',
    argv: process.argv.map(redactDesktopAuthCallbackUrl),
    isDefaultApp: Reflect.get(process, 'defaultApp') === true,
    execPath: process.execPath,
  });
  installDesktopProtocolLifecycle({
    app,
    controller: desktopProtocol,
    processInfo: {
      isDefaultApp: Reflect.get(process, 'defaultApp') === true,
      execPath: process.execPath,
      argv: process.argv,
    },
    startBackendWindowAndDrainProtocolCallbacks,
    reopenFromSecondInstance,
    logError: (message, error) => {
      console.error(`[agendex-desktop] ${message}`, error);
    },
    quit: () => {
      app.quit();
    },
  });

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('dev.agendex.desktop');

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    registerDesktopIpc({
      ipcMain,
      getLocalApiToken: () => localApiToken,
      loadCloudCreds,
      loadModePref,
      saveModePref,
      refreshCloudSession,
      getConvexAuthToken,
      writeQaBootstrapEvidence,
      getSiteUrl: () => getSiteUrl(is.dev),
      startDesktopAuthLogin,
      clearPendingDesktopAuthLogin,
      createPendingLoginCompletion: desktopProtocol.createPendingLoginCompletion,
      clearCloudCreds,
      getAuthSessionGeneration: () => authSessionGeneration,
      isAuthSessionGenerationCurrent,
      invalidateAuthSession,
      syncDaemonSession,
      stopDesktopDaemon: () => desktopDaemon.stop(),
      logLoginError: (error) => {
        console.error('[agendex-desktop] cloud login failed', error);
      },
    });
    buildMenu(
      desktopUpdater.isSupported
        ? { onCheckForUpdates: () => void desktopUpdater.checkForUpdatesInteractive() }
        : {},
    );
    desktopUpdater.start();

    const bootstrapAuthGeneration = authSessionGeneration;
    void refreshCloudSession()
      .then(async (creds) => {
        if (creds && isAuthSessionGenerationCurrent(bootstrapAuthGeneration)) {
          void syncDaemonSession(creds);
        }
        await startBackendWindowAndDrainProtocolCallbacks();
      })
      .catch((err) => {
        console.error('[agendex-desktop] failed to start backend', err);
        app.quit();
      });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void startBackendWindowAndDrainProtocolCallbacks().catch((err) => {
          console.error('[agendex-desktop] failed to reopen window', err);
          app.quit();
        });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitAfterShutdown) return;
    event.preventDefault();
    void shutdownDesktopServices().finally(() => {
      quitAfterShutdown = true;
      app.quit();
    });
  });
}
