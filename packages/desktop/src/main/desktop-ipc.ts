import type { IpcMain } from 'electron';
import type { CloudCreds, ConvexAuthTokenResult } from './cloud-auth.ts';
import { parseDesktopAuthProvider, type DesktopAuthProvider } from './cloud-login-url.ts';
import { handleDesktopAuthFetch } from './desktop-auth-fetch.ts';

type PendingDesktopLogin = {
  readonly state: string;
  readonly expiresAtMs: number;
};

type WindowsEnvStatusLike = {
  readonly env: 'native' | 'wsl';
  readonly wslAvailable: boolean;
  readonly wslDistroName: string | null;
  readonly wslHomePath: string | null;
  readonly error?: string;
};

type WindowsEnvSetResultLike = WindowsEnvStatusLike & {
  readonly ok: boolean;
  readonly willRelaunch: boolean;
};

type RegisterDesktopIpcDeps = {
  readonly ipcMain: IpcMain;
  readonly getLocalApiToken: () => string;
  readonly loadCloudCreds: () => CloudCreds | null;
  readonly loadModePref: () => 'local' | 'cloud' | null;
  readonly saveModePref: (mode: 'local' | 'cloud') => void;
  readonly getWindowsEnvStatus?: () => Promise<WindowsEnvStatusLike>;
  readonly setWindowsEnv?: (env: 'native' | 'wsl') => Promise<WindowsEnvSetResultLike>;
  readonly refreshCloudSession: () => Promise<CloudCreds | null>;
  readonly getConvexAuthToken: () => Promise<ConvexAuthTokenResult | null>;
  readonly writeQaBootstrapEvidence: (payload: unknown) => void;
  readonly getSiteUrl: () => string;
  readonly startDesktopAuthLogin: (
    siteUrl: string,
    provider?: DesktopAuthProvider,
  ) => Promise<PendingDesktopLogin>;
  readonly clearPendingDesktopAuthLogin: () => void;
  readonly createPendingLoginCompletion: (state: string, expiresAtMs?: number) => Promise<boolean>;
  readonly clearCloudCreds: () => void;
  readonly clearAllObfuscationKeys?: () => void;
  readonly storeObfuscationKey?: (
    workspaceOwnerId: string,
    keyEpoch: number,
    keyBase64: string,
  ) => boolean;
  readonly loadObfuscationKey?: (workspaceOwnerId: string, keyEpoch: number) => string | null;
  readonly clearObfuscationKey?: (workspaceOwnerId: string, keyEpoch: number) => void;
  readonly updateDaemonWorkspaceKey?: (
    workspaceOwnerId: string,
    keyEpoch: number,
    keyBase64: string | null,
  ) => void;
  readonly getAuthSessionGeneration: () => number;
  readonly isAuthSessionGenerationCurrent: (generation: number) => boolean;
  readonly invalidateAuthSession: () => void;
  readonly syncDaemonSession: (creds: CloudCreds) => Promise<void>;
  readonly stopDesktopDaemon: () => Promise<void>;
  readonly logLoginError: (error: Error) => void;
};

function syncDaemonSession(deps: RegisterDesktopIpcDeps, creds: CloudCreds): void {
  void deps.syncDaemonSession(creds).catch((error) => {
    deps.logLoginError(error instanceof Error ? error : new Error(String(error)));
  });
}

async function startLoginSupersedingStaleAttempt(
  deps: RegisterDesktopIpcDeps,
  siteUrl: string,
  provider?: DesktopAuthProvider,
) {
  try {
    return await deps.startDesktopAuthLogin(siteUrl, provider);
  } catch (err) {
    if (
      !(err instanceof Error) ||
      !('code' in err) ||
      Reflect.get(err, 'code') !== 'active-attempt'
    ) {
      throw err;
    }
    deps.clearPendingDesktopAuthLogin();
    return await deps.startDesktopAuthLogin(siteUrl, provider);
  }
}

async function startLogin(deps: RegisterDesktopIpcDeps, provider: unknown): Promise<boolean> {
  const authGeneration = deps.getAuthSessionGeneration();
  try {
    const parsedProvider = parseDesktopAuthProvider(provider);
    if (parsedProvider === null) return false;
    const pending = await startLoginSupersedingStaleAttempt(
      deps,
      deps.getSiteUrl(),
      parsedProvider,
    );
    const completed = await deps.createPendingLoginCompletion(pending.state, pending.expiresAtMs);
    if (!deps.isAuthSessionGenerationCurrent(authGeneration)) return false;
    const creds = completed ? deps.loadCloudCreds() : null;
    if (creds) syncDaemonSession(deps, creds);
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

  if (deps.getWindowsEnvStatus) {
    deps.ipcMain.handle('agendex:get-windows-env', async () => {
      return deps.getWindowsEnvStatus?.() ?? null;
    });
  }

  if (deps.setWindowsEnv) {
    deps.ipcMain.handle('agendex:set-windows-env', async (_event, env: unknown) => {
      if (env !== 'native' && env !== 'wsl') {
        return {
          ok: false,
          willRelaunch: false,
          env: 'native' as const,
          wslAvailable: false,
          wslDistroName: null,
          wslHomePath: null,
          error: 'Invalid environment',
        };
      }
      return deps.setWindowsEnv?.(env) ?? null;
    });
  }

  deps.ipcMain.handle('agendex:refresh-cloud-session', async () => {
    const authGeneration = deps.getAuthSessionGeneration();
    const creds = await deps.refreshCloudSession();
    if (!deps.isAuthSessionGenerationCurrent(authGeneration)) return null;
    if (creds) syncDaemonSession(deps, creds);
    else if (deps.loadCloudCreds() === null) await deps.stopDesktopDaemon();
    return creds;
  });
  deps.ipcMain.handle('agendex:get-convex-auth-token', async () => {
    const authGeneration = deps.getAuthSessionGeneration();
    const result = await deps.getConvexAuthToken();
    if (!deps.isAuthSessionGenerationCurrent(authGeneration)) {
      return { sessionCleared: true };
    }
    if (result) {
      syncDaemonSession(deps, result.cloudSession);
      return result;
    }
    const sessionCleared = deps.loadCloudCreds() === null;
    if (sessionCleared) await deps.stopDesktopDaemon();
    return { sessionCleared };
  });

  deps.ipcMain.handle('agendex:auth-fetch', async (_event, url: unknown, init: unknown) => {
    return handleDesktopAuthFetch({ loadCloudCreds: deps.loadCloudCreds }, url, init);
  });

  if (deps.storeObfuscationKey && deps.loadObfuscationKey && deps.clearObfuscationKey) {
    deps.ipcMain.handle(
      'agendex:obfuscation:store-key',
      (_event, workspaceOwnerId: unknown, keyEpoch: unknown, keyBase64: unknown) => {
        if (
          typeof workspaceOwnerId !== 'string' ||
          !workspaceOwnerId.trim() ||
          typeof keyEpoch !== 'number' ||
          !Number.isSafeInteger(keyEpoch) ||
          keyEpoch < 1 ||
          typeof keyBase64 !== 'string' ||
          !/^[A-Za-z0-9+/]{43}=$/.test(keyBase64)
        ) {
          return false;
        }
        const stored = deps.storeObfuscationKey?.(workspaceOwnerId, keyEpoch, keyBase64) ?? false;
        if (stored) deps.updateDaemonWorkspaceKey?.(workspaceOwnerId, keyEpoch, keyBase64);
        return stored;
      },
    );
    deps.ipcMain.handle(
      'agendex:obfuscation:load-key',
      (_event, workspaceOwnerId: unknown, keyEpoch: unknown) => {
        if (typeof workspaceOwnerId !== 'string' || typeof keyEpoch !== 'number') return null;
        return deps.loadObfuscationKey?.(workspaceOwnerId, keyEpoch) ?? null;
      },
    );
    deps.ipcMain.handle(
      'agendex:obfuscation:clear-key',
      (_event, workspaceOwnerId: unknown, keyEpoch: unknown) => {
        if (typeof workspaceOwnerId !== 'string' || typeof keyEpoch !== 'number') return false;
        deps.clearObfuscationKey?.(workspaceOwnerId, keyEpoch);
        deps.updateDaemonWorkspaceKey?.(workspaceOwnerId, keyEpoch, null);
        return true;
      },
    );
  }

  deps.ipcMain.on('agendex:qa-bootstrap-observed', (_event, payload: unknown) => {
    deps.writeQaBootstrapEvidence(payload);
  });

  deps.ipcMain.handle('agendex:login', async (_event, provider: unknown) => {
    return startLogin(deps, provider);
  });

  deps.ipcMain.handle('agendex:logout', async () => {
    deps.invalidateAuthSession();
    deps.clearPendingDesktopAuthLogin();
    await deps.stopDesktopDaemon();
    deps.clearAllObfuscationKeys?.();
    deps.clearCloudCreds();
    return true;
  });
}
