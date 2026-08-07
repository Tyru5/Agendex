import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { resolveDesktopBuildInfo } from './desktop-build-info.ts';
import { registerDesktopIpc } from './desktop-ipc.ts';
import { buildMenu } from './desktop-menu.ts';
import { createDesktopProtocolController } from './desktop-protocol.ts';
import { installDesktopQuitLifecycle } from './desktop-quit.ts';
import { writeQaBootstrapEvidence, writeQaStartupEvidence } from './desktop-qa-evidence.ts';
import { createDesktopUpdater, isPortableWindowsBuild } from './desktop-updater.ts';
import { createDesktopWindow } from './desktop-window.ts';
import { redactDesktopAuthCallbackUrl } from '@agendex/shared/desktop-auth-callback';
import { installDesktopProtocolLifecycle } from './desktop-protocol-lifecycle.ts';
import { stopDesktopServices } from './desktop-shutdown.ts';
import { loadWithRetry } from './window-loader.ts';
import { DesktopDaemonManager } from './desktop-daemon-manager.ts';
import { DesktopBackendManager, type DesktopBackendConnection } from './desktop-backend-manager.ts';
import { getUiFeedUrl, isUiUpdateDisabled } from './ui-bundle/config.ts';
import { getUiBundlePublicKey, hasUiBundlePublicKey } from './ui-bundle/keys.ts';
import { createUiBundleStore } from './ui-bundle/store.ts';
import { createUiUpdater } from './ui-updater.ts';
import {
  applyWindowsEnvAtBoot,
  createWindowsEnvRuntime,
  detectWsl,
  getWindowsEnvStatus,
  loadWindowsEnvPref,
  mergeWorkerEnv,
  resolveRuntimeEnvVars,
  saveWindowsEnvPref,
  type WindowsAgentEnv,
  type WindowsEnvSetResult,
  type WindowsEnvStatus,
} from './windows-env.ts';

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
let backendConnection: DesktopBackendConnection | null = null;
let localApiToken = '';
let rendererTargetUrl = '';
let backendBoot: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;
let authSessionGeneration = 0;
const windowsEnvRuntime = process.platform === 'win32' ? createWindowsEnvRuntime(is.dev) : null;
/** Env patch applied at boot for local server + daemon worker (win32 only). */
let windowsRuntimeEnvPatch: Record<string, string | undefined> = windowsEnvRuntime
  ? { AGENDEX_CONFIG_DIR: windowsEnvRuntime.nativeConfigDir }
  : {};
let windowsEnvBootPromise: Promise<void> | null = null;

function invalidateAuthSession(): void {
  authSessionGeneration += 1;
}

function isAuthSessionGenerationCurrent(generation: number): boolean {
  return generation === authSessionGeneration;
}

function logDesktop(message: string, error?: unknown): void {
  if (error === undefined) console.error(`[agendex-desktop] ${message}`);
  else console.error(`[agendex-desktop] ${message}`, error);
}

/**
 * The UI the app shipped with. Immutable: on macOS it lives inside the signed,
 * notarized .app, so it is the offline floor rather than an update target.
 * Downloaded bundles live under userData — see ui-bundle/store.ts.
 */
function resolveShippedClientDistDir(): string {
  if (app.isPackaged) {
    // electron-builder copies the built EE client to resources/client (see electron-builder.yml).
    return join(process.resourcesPath, 'client');
  }
  // Dev/unpackaged prod-serve: out/main -> packages/ee/dist
  return join(__dirname, '../../../ee/dist');
}

function resolveBackendClientDistDir(): string {
  return is.dev ? resolveShippedClientDistDir() : uiBundleStore.resolveActiveDir();
}

const uiBundleRootDir = join(app.getPath('userData'), 'ui');

const uiBundleStore = createUiBundleStore({
  rootDir: uiBundleRootDir,
  shippedDir: resolveShippedClientDistDir(),
  shellVersion: app.getVersion(),
  log: logDesktop,
});

function createWindow(targetUrl: string): void {
  mainWindow = createDesktopWindow(targetUrl, () => {
    mainWindow = null;
  });
  // Secondary net under the boot sentinel in ui-updater: this catches a bundle
  // that fails to load outright. A bundle whose JS throws after loading still
  // fires did-finish-load, which is why the sentinel timer exists as well.
  mainWindow.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) uiUpdater.notifyLoadFailure();
  });
  mainWindow.webContents.on('render-process-gone', () => {
    uiUpdater.notifyLoadFailure();
  });
}

async function ensureBackend() {
  const clientDistDir = resolveBackendClientDistDir();
  desktopBackend.setClientDistDir(clientDistDir);
  if (backendConnection) return;
  if (backendBoot) {
    await backendBoot;
    return;
  }

  backendBoot = (async () => {
    if (is.dev) {
      // Renderer HMR: API on the fixed port the EE client's dev proxy + WS expect,
      // window points at the EE Vite dev server. Dev never serves a downloaded
      // bundle — the Vite dev server is the renderer.
      backendConnection = await desktopBackend.start({
        port: DEV_SERVER_PORT,
        clientDistDir,
        hostname: '127.0.0.1',
      });
    } else {
      // Prod: ephemeral port on `localhost` (a cloud-trusted origin so better-auth
      // CORS accepts the desktop), client + local API served from the same origin.
      //
      // The client directory is resolved per request, so activating a downloaded
      // UI bundle takes effect on the next page load without restarting the
      // server or changing the origin.
      backendConnection = await desktopBackend.start({
        port: 0,
        clientDistDir,
        hostname: 'localhost',
      });
    }
    applyBackendConnection(backendConnection);
  })();

  try {
    await backendBoot;
  } finally {
    backendBoot = null;
  }
}

function applyBackendConnection(connection: DesktopBackendConnection): void {
  backendConnection = connection;
  localApiToken = connection.token;
  rendererTargetUrl = is.dev
    ? (process.env.AGENDEX_RENDERER_URL ?? DEV_RENDERER_URL)
    : `http://localhost:${connection.port}/dashboard`;
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
  // Keep rollback/quarantine decisions authoritative even while macOS has no window.
  desktopBackend.setClientDistDir(resolveBackendClientDistDir());
  if (!backendConnection || !mainWindow || mainWindow.isDestroyed()) return;
  loadWithRetry(mainWindow, rendererTargetUrl);
}

const desktopBackend = new DesktopBackendManager({
  forkWorker: utilityProcess.fork,
  getWorkerEnv: () => mergeWorkerEnv(process.env, windowsRuntimeEnvPatch),
  log: logDesktop,
  onUnexpectedExit: (error) => {
    backendConnection = null;
    localApiToken = '';
    desktopBackend.setClientDistDir(resolveBackendClientDistDir());
    logDesktop('Local API worker exited', error);
  },
  onConnectionRestored: (connection) => {
    if (shutdownPromise) return;
    applyBackendConnection(connection);
    reloadMainWindow();
  },
});

const desktopDaemon = new DesktopDaemonManager({
  isDev: is.dev,
  forkWorker: utilityProcess.fork,
  getWorkerEnv: () => mergeWorkerEnv(process.env, windowsRuntimeEnvPatch),
  onStateChange: (state) => {
    mainWindow?.webContents.send('agendex:daemon-state', state);
  },
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
});

// Resolved once: app-update.yml is written at package time and cannot change
// while the app runs.
const desktopBuildInfo = resolveDesktopBuildInfo({
  platform: process.platform,
  isPackaged: app.isPackaged,
  readAppUpdateConfig: () => {
    try {
      return readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8');
    } catch {
      return null;
    }
  },
});

ipcMain.handle('agendex:update:check', () => desktopUpdater.checkForUpdates());
ipcMain.handle('agendex:update:install', () => desktopUpdater.quitAndInstall());
ipcMain.handle('agendex:update:get-state', () => desktopUpdater.getState());
ipcMain.handle('agendex:get-app-version', () => app.getVersion());
ipcMain.handle('agendex:get-build-info', () => desktopBuildInfo);
ipcMain.handle('agendex:daemon:get-state', () => desktopDaemon.getState());

const desktopUpdater = createDesktopUpdater({
  // electron-updater is CJS-only and ships no `default` export; import the
  // named `autoUpdater` binding so bundler interop can't yield `undefined`.
  updater: autoUpdater,
  isPackaged: app.isPackaged,
  isPortable: isPortableWindowsBuild(),
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
  onStateChange: (state) => {
    mainWindow?.webContents.send('agendex:update:state', state);
  },
  log: (message, error) => {
    if (error === undefined) console.error(`[agendex-desktop] ${message}`);
    else console.error(`[agendex-desktop] ${message}`, error);
  },
});

// UI-only updates. Independent of desktopUpdater above: this swaps the served
// client bundle without replacing the app, so a UI change ships without a new
// signed Electron build. Unlike the app updater it stays enabled for Windows
// portable builds, which cannot self-replace but can still write to userData.
const uiUpdater = createUiUpdater({
  store: uiBundleStore,
  rootDir: uiBundleRootDir,
  feedUrl: getUiFeedUrl(),
  publicKeyPem: getUiBundlePublicKey(),
  shellVersion: app.getVersion(),
  fetchImpl: (input, init) => fetch(input, init),
  isPackaged: app.isPackaged,
  // No baked signing key means nothing can be trusted, so stay on the shipped UI.
  enabled: !isUiUpdateDisabled() && hasUiBundlePublicKey(),
  promptToReload: async ({ label }) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Interface Update Ready',
      message: 'A new version of the Agendex interface is ready.',
      detail: `Reload to start using it (${label}), or it will be applied the next time you open Agendex.`,
      buttons: ['Reload Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    return { reloadNow: response === 0 };
  },
  applyReload: () => reloadMainWindow(),
  onStateChange: (state) => {
    mainWindow?.webContents.send('agendex:ui-update:state', state);
  },
  log: logDesktop,
});

ipcMain.handle('agendex:ui-update:check', () => uiUpdater.checkForUpdates());
ipcMain.handle('agendex:ui-update:apply', () => uiUpdater.applyStaged());
ipcMain.handle('agendex:ui-update:get-state', () => uiUpdater.getState());
ipcMain.handle('agendex:get-ui-revision', () => uiBundleStore.servedRevision());
// Sent by the renderer once React mounts. This is what proves the *bundle's*
// JavaScript ran: the preload firing only proves the shell loaded.
ipcMain.on('agendex:ui-ready', () => uiUpdater.notifyRendererReady());

async function ensureWindowsEnvApplied(): Promise<void> {
  if (process.platform !== 'win32' || !windowsEnvRuntime) return;
  if (windowsEnvBootPromise) return windowsEnvBootPromise;

  windowsEnvBootPromise = (async () => {
    const detection = await detectWsl();
    const applied = applyWindowsEnvAtBoot(windowsEnvRuntime, detection);
    windowsRuntimeEnvPatch = applied.patch;
    if (applied.error) {
      logDesktop(`Windows agent env fell back to native: ${applied.error}`);
    } else if (applied.env === 'wsl') {
      logDesktop(`Windows agent env: WSL (${applied.patch.AGENDEX_HOME ?? 'unknown home'})`);
    }
  })();

  return windowsEnvBootPromise;
}

async function readWindowsEnvStatus(): Promise<WindowsEnvStatus> {
  if (!windowsEnvRuntime) {
    return {
      env: 'native',
      wslAvailable: false,
      wslDistroName: null,
      wslHomePath: null,
      error: 'Not Windows',
    };
  }
  return getWindowsEnvStatus({ runtime: windowsEnvRuntime });
}

async function setWindowsAgentEnv(env: WindowsAgentEnv): Promise<WindowsEnvSetResult> {
  if (!windowsEnvRuntime || process.platform !== 'win32') {
    return {
      ok: false,
      willRelaunch: false,
      env: 'native',
      wslAvailable: false,
      wslDistroName: null,
      wslHomePath: null,
      error: 'Not Windows',
    };
  }

  const detection = await detectWsl();
  const statusBase = {
    wslAvailable: detection.available,
    wslDistroName: detection.distroName,
    wslHomePath: detection.homePath,
  };

  if (env === 'wsl' && !detection.available) {
    return {
      ok: false,
      willRelaunch: false,
      env: loadWindowsEnvPref(),
      ...statusBase,
      error: detection.error ?? 'WSL not available',
    };
  }

  const current = loadWindowsEnvPref();
  if (current === env) {
    const resolved = resolveRuntimeEnvVars(env, windowsEnvRuntime, detection);
    return {
      ok: true,
      willRelaunch: false,
      env: resolved.env,
      ...statusBase,
      ...(resolved.error ? { error: resolved.error } : {}),
    };
  }

  saveWindowsEnvPref(env);
  app.relaunch();
  app.quit();
  return {
    ok: true,
    willRelaunch: true,
    env,
    ...statusBase,
  };
}

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
  mainWindow = null;
  backendConnection = null;
  let resolveShutdown: (() => void) | undefined;
  shutdownPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  void stopDesktopServices({
    window,
    stopDaemon: () => desktopDaemon.stop(),
    closeServer: () => desktopBackend.stop(),
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
      ...(process.platform === 'win32'
        ? {
            getWindowsEnvStatus: readWindowsEnvStatus,
            setWindowsEnv: setWindowsAgentEnv,
          }
        : {}),
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

    // Before anything is served: a bundle still marked pending from the last run
    // never reported a successful boot, so treat it as broken and fall back.
    uiUpdater.reconcilePendingVerify();
    uiUpdater.start();

    const bootstrapAuthGeneration = authSessionGeneration;
    void ensureWindowsEnvApplied()
      .then(() => refreshCloudSession())
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
        void ensureWindowsEnvApplied()
          .then(() => startBackendWindowAndDrainProtocolCallbacks())
          .catch((err) => {
            console.error('[agendex-desktop] failed to reopen window', err);
            app.quit();
          });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  installDesktopQuitLifecycle({
    app,
    shutdownServices: shutdownDesktopServices,
    log: (message, error) => {
      if (error === undefined) console.error(`[agendex-desktop] ${message}`);
      else console.error(`[agendex-desktop] ${message}`, error);
    },
  });
}
