import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startNodeServer, type RunningNodeServer } from '@agendex/app/server';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  clearCloudCreds,
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
  DesktopAuthLoginError,
  loadPendingDesktopAuthLogin,
  startDesktopAuthLogin,
} from './cloud-login.ts';
import { parseDesktopAuthProvider, type DesktopAuthProvider } from './cloud-login-url.ts';
import { loadModePref, saveModePref } from './dashboard-mode.ts';
import { buildMenu } from './desktop-menu.ts';
import { createDesktopProtocolController } from './desktop-protocol.ts';
import { createDesktopWindow } from './desktop-window.ts';
import { redactDesktopAuthCallbackUrl } from '@agendex/shared/desktop-auth-callback';
import { installDesktopProtocolLifecycle } from './desktop-protocol-lifecycle.ts';
import { loadWithRetry } from './window-loader.ts';

// Package name is `@agendex/desktop`; without this, Electron labels the
// macOS Keychain item for safeStorage as "@agendex/desktop Safe Storage".
// Set before any safeStorage use so the prompt reads "Agendex Safe Storage".
app.setName('Agendex');

const DEV_SERVER_PORT = 4890;
const DEV_RENDERER_URL = 'http://app.agendex.localhost:5174/dashboard';

let mainWindow: BrowserWindow | null = null;
let server: RunningNodeServer | null = null;
let localApiToken = '';
let rendererTargetUrl = '';
let backendBoot: Promise<void> | null = null;

function writeQaBootstrapEvidence(payload: unknown): void {
  const path = process.env.AGENDEX_DESKTOP_QA_BOOTSTRAP_PATH;
  if (!path) return;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeQaStartupEvidence(payload: unknown): void {
  const path = process.env.AGENDEX_DESKTOP_QA_STARTUP_PATH;
  if (!path) return;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path, `${JSON.stringify(payload)}\n`, 'utf8');
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

const desktopProtocol = createDesktopProtocolController({
  loadPendingLogin: loadPendingDesktopAuthLogin,
  completePendingLogin: completePendingDesktopAuthLogin,
  validateCloudCreds: async (creds) => {
    writeQaStartupEvidence({
      event: 'desktop-auth-callback-validate-start',
      convexSiteUrl: creds.convexSiteUrl,
      tokenPresent: Boolean(creds.token),
    });
    const validated = await validateCloudCreds(creds);
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

/**
 * A pending login attempt survives window reloads and app restarts (it lives
 * in userData), so an abandoned browser flow would otherwise block sign-in
 * with `active-attempt` for up to 5 minutes. A fresh user gesture supersedes
 * the stale attempt: its state is invalidated and a new flow starts.
 */
async function startLoginSupersedingStaleAttempt(siteUrl: string, provider?: DesktopAuthProvider) {
  try {
    return await startDesktopAuthLogin(siteUrl, provider);
  } catch (err) {
    if (!(err instanceof DesktopAuthLoginError) || err.code !== 'active-attempt') throw err;
    clearPendingDesktopAuthLogin();
    return await startDesktopAuthLogin(siteUrl, provider);
  }
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
  ipcMain.handle('agendex:get-convex-auth-token', async () => {
    const result = await getConvexAuthToken();
    if (result) return result;
    // A null token is ambiguous: the session may have been definitively
    // revoked (creds cleared after a 401/403) or the request may have failed
    // transiently. Tell the preload which one so it only drops to the sign-in
    // gate for real revocations.
    return { sessionCleared: loadCloudCreds() === null };
  });

  ipcMain.on('agendex:qa-bootstrap-observed', (_event, payload: unknown) => {
    writeQaBootstrapEvidence(payload);
  });

  ipcMain.handle('agendex:login', async (_event, provider: unknown) => {
    try {
      const parsedProvider = parseDesktopAuthProvider(provider);
      if (parsedProvider === null) return false;
      const siteUrl = getSiteUrl(is.dev);
      const pending = await startLoginSupersedingStaleAttempt(siteUrl, parsedProvider);
      return await desktopProtocol.createPendingLoginCompletion(pending.state, pending.expiresAtMs);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[agendex-desktop] cloud login failed', error);
      return false;
    }
  });

  ipcMain.handle('agendex:logout', () => {
    clearCloudCreds();
    return true;
  });
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

    registerIpc();
    buildMenu();

    void refreshCloudSession()
      .then(() => startBackendWindowAndDrainProtocolCallbacks())
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

  app.on('before-quit', () => {
    void server?.close();
    server = null;
  });
}
