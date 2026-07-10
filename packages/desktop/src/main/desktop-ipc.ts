import type { IpcMain } from 'electron';
import type { CloudCreds, ConvexAuthTokenResult } from './cloud-auth.ts';
import {
  clearPendingDesktopAuthLogin,
  DesktopAuthLoginError,
  startDesktopAuthLogin,
} from './cloud-login.ts';
import { parseDesktopAuthProvider, type DesktopAuthProvider } from './cloud-login-url.ts';
import { handleDesktopAuthFetch } from './desktop-auth-fetch.ts';

type RegisterDesktopIpcDeps = {
  readonly ipcMain: IpcMain;
  readonly getLocalApiToken: () => string;
  readonly loadCloudCreds: () => CloudCreds | null;
  readonly loadModePref: () => 'local' | 'cloud' | null;
  readonly saveModePref: (mode: 'local' | 'cloud') => void;
  readonly refreshCloudSession: () => Promise<CloudCreds | null>;
  readonly getConvexAuthToken: () => Promise<ConvexAuthTokenResult | null>;
  readonly writeQaBootstrapEvidence: (payload: unknown) => void;
  readonly getSiteUrl: () => string;
  readonly createPendingLoginCompletion: (state: string, expiresAtMs?: number) => Promise<boolean>;
  readonly clearCloudCreds: () => void;
  readonly syncDaemonSession: (creds: CloudCreds) => Promise<void>;
  readonly stopDesktopDaemon: () => Promise<void>;
  readonly logLoginError: (error: Error) => void;
};

async function startLoginSupersedingStaleAttempt(siteUrl: string, provider?: DesktopAuthProvider) {
  try {
    return await startDesktopAuthLogin(siteUrl, provider);
  } catch (err) {
    if (!(err instanceof DesktopAuthLoginError) || err.code !== 'active-attempt') throw err;
    clearPendingDesktopAuthLogin();
    return await startDesktopAuthLogin(siteUrl, provider);
  }
}

async function startLogin(deps: RegisterDesktopIpcDeps, provider: unknown): Promise<boolean> {
  try {
    const parsedProvider = parseDesktopAuthProvider(provider);
    if (parsedProvider === null) return false;
    const pending = await startLoginSupersedingStaleAttempt(deps.getSiteUrl(), parsedProvider);
    const completed = await deps.createPendingLoginCompletion(pending.state, pending.expiresAtMs);
    const creds = completed ? deps.loadCloudCreds() : null;
    if (creds) await deps.syncDaemonSession(creds);
    return completed;
  } catch (err) {
    deps.logLoginError(err instanceof Error ? err : new Error(String(err)));
    return false;
  }
}

export function registerDesktopIpc(deps: RegisterDesktopIpcDeps): void {
  deps.ipcMain.on('agendex:get-bootstrap', (event) => {
    const cloud = deps.loadCloudCreds();
    event.returnValue = {
      localToken: deps.getLocalApiToken(),
      cloudToken: cloud?.token ?? null,
      convexSiteUrl: cloud?.convexSiteUrl ?? null,
      modePref: deps.loadModePref(),
    };
  });

  deps.ipcMain.handle('agendex:set-mode-pref', (_event, mode: unknown) => {
    if (mode !== 'local' && mode !== 'cloud') return false;
    deps.saveModePref(mode);
    return true;
  });

  deps.ipcMain.handle('agendex:refresh-cloud-session', async () => {
    const creds = await deps.refreshCloudSession();
    if (creds) await deps.syncDaemonSession(creds);
    return creds;
  });
  deps.ipcMain.handle('agendex:get-convex-auth-token', async () => {
    const result = await deps.getConvexAuthToken();
    if (result) {
      await deps.syncDaemonSession(result.cloudSession);
      return result;
    }
    return { sessionCleared: deps.loadCloudCreds() === null };
  });

  deps.ipcMain.handle('agendex:auth-fetch', async (_event, url: unknown, init: unknown) => {
    return handleDesktopAuthFetch({ loadCloudCreds: deps.loadCloudCreds }, url, init);
  });

  deps.ipcMain.on('agendex:qa-bootstrap-observed', (_event, payload: unknown) => {
    deps.writeQaBootstrapEvidence(payload);
  });

  deps.ipcMain.handle('agendex:login', async (_event, provider: unknown) => {
    return startLogin(deps, provider);
  });

  deps.ipcMain.handle('agendex:logout', async () => {
    await deps.stopDesktopDaemon();
    deps.clearCloudCreds();
    return true;
  });
}
