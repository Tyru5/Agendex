import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge, ipcRenderer } from 'electron';

interface Bootstrap {
  localToken: string | null;
  cloudToken: string | null;
  convexSiteUrl: string | null;
  modePref: 'local' | 'cloud' | null;
}

type DesktopAuthProvider = 'github' | 'google';
interface CloudSession {
  token: string;
  convexSiteUrl: string;
}

const MODE_PREF_KEY = 'agendex_dashboard_mode';

function readBootstrap(): Bootstrap {
  try {
    return ipcRenderer.sendSync('agendex:get-bootstrap') as Bootstrap;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] failed to read bootstrap', error);
    return { localToken: null, cloudToken: null, convexSiteUrl: null, modePref: null };
  }
}

const bootstrap = readBootstrap();

/**
 * Mutable session bag. `contextBridge.exposeInMainWorld` freezes the exposed
 * object in the renderer, so we must not assign `agendexDesktop.cloudToken`
 * (that throws "Cannot assign to read only property"). Getters read this bag
 * live from the isolated world so refresh/logout updates are visible without
 * reloading, and methods mutate the bag rather than the frozen facade.
 */
const session = {
  cloudToken: bootstrap.cloudToken as string | null,
  convexSiteUrl: bootstrap.convexSiteUrl as string | null,
};

function reportQaBootstrap() {
  if (!process.env.AGENDEX_DESKTOP_QA_BOOTSTRAP_PATH) return;
  ipcRenderer.send('agendex:qa-bootstrap-observed', {
    href: window.location.href,
    cloudTokenPresent: Boolean(session.cloudToken),
    convexSiteUrl: session.convexSiteUrl,
    modePref: bootstrap.modePref,
    desktopDataset: true,
  });
}

/**
 * Seeds the local API token so the desktop skips the manual local-connect step.
 * The web client reads `localStorage.agendex_token` directly, and the preload
 * shares the page's storage origin, so we can set it before page scripts run.
 */
function injectLocalToken() {
  if (!bootstrap.localToken) return;
  try {
    window.localStorage.setItem('agendex_token', bootstrap.localToken);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] failed to inject local token', error);
  }
}

function injectDesktopPrefs() {
  injectLocalToken();
  if (!bootstrap.modePref) return;
  try {
    window.localStorage.setItem(MODE_PREF_KEY, bootstrap.modePref);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] failed to inject mode preference', error);
  }
}

// The cloud session bridge: exposes the session token (used as a Bearer
// credential by the EE client) plus the system-browser login/logout flows.
const agendexDesktop = {
  isDesktop: true as const,
  get cloudToken(): string | null {
    return session.cloudToken;
  },
  get convexSiteUrl(): string | null {
    return session.convexSiteUrl;
  },
  login: async (provider?: DesktopAuthProvider): Promise<boolean> => {
    const ok = await ipcRenderer.invoke('agendex:login', provider);
    return ok === true;
  },
  logout: async (): Promise<boolean> => {
    const ok = (await ipcRenderer.invoke('agendex:logout')) as boolean;
    session.cloudToken = null;
    session.convexSiteUrl = null;
    return ok;
  },
  setModePref: (mode: 'local' | 'cloud'): Promise<boolean> =>
    ipcRenderer.invoke('agendex:set-mode-pref', mode),
  refreshCloudSession: async (): Promise<{
    token: string;
    convexSiteUrl: string;
  } | null> => {
    const refreshed = (await ipcRenderer.invoke('agendex:refresh-cloud-session')) as {
      token?: string;
      convexSiteUrl?: string;
    } | null;
    if (refreshed?.token && refreshed.convexSiteUrl) {
      session.cloudToken = refreshed.token;
      session.convexSiteUrl = refreshed.convexSiteUrl;
      return { token: refreshed.token, convexSiteUrl: refreshed.convexSiteUrl };
    }
    if (refreshed === null) {
      session.cloudToken = null;
      session.convexSiteUrl = null;
    }
    return null;
  },
  getConvexAuthToken: async (): Promise<string | null> => {
    const result = (await ipcRenderer.invoke('agendex:get-convex-auth-token')) as {
      token?: string;
      cloudSession?: Partial<CloudSession>;
      sessionCleared?: boolean;
    } | null;
    if (result?.cloudSession?.token && result.cloudSession.convexSiteUrl) {
      session.cloudToken = result.cloudSession.token;
      session.convexSiteUrl = result.cloudSession.convexSiteUrl;
    }
    if (result?.sessionCleared && session.cloudToken) {
      // Session revoked and main process cleared stored creds. Reload so the
      // page re-bootstraps without a stale token and lands on the sign-in gate.
      session.cloudToken = null;
      session.convexSiteUrl = null;
      window.location.reload();
      return null;
    }
    return typeof result?.token === 'string' && result.token.trim() ? result.token : null;
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('agendexDesktop', agendexDesktop);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error);
  }
} else {
  Object.assign(window, { electron: electronAPI, agendexDesktop });
}

injectDesktopPrefs();
reportQaBootstrap();
