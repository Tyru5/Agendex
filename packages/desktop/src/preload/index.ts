import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge, ipcRenderer, webFrame } from 'electron';

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

type DesktopAuthFetchInit = {
  readonly method: string;
  readonly headers: readonly [string, string][];
  readonly body: string | null;
};

type DesktopAuthFetchResult = {
  readonly body: string | null;
  readonly headers: readonly [string, string][];
  readonly status: number;
  readonly statusText: string;
};

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'no-update'
  | 'error'
  | 'unsupported';

interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  error?: string;
}

interface DesktopBuildInfo {
  platform: string;
  /** null when unknown: dev builds, and platforms that record no signing evidence. */
  codeSigned: boolean | null;
}

// Forward update state from the main process to the renderer as a DOM event.
// contextIsolation prevents passing callbacks through contextBridge, so we
// dispatch a CustomEvent on the shared window object that the renderer can
// listen for with window.addEventListener.
ipcRenderer.on('agendex:update:state', (_event, state: UpdateState) => {
  window.dispatchEvent(new CustomEvent('agendex:update:state', { detail: state }));
});

function emitPageZoom(factor = webFrame.getZoomFactor()) {
  window.dispatchEvent(new CustomEvent('agendex:page-zoom', { detail: factor }));
}

ipcRenderer.on('agendex:page-zoom', (_event, factor: number) => {
  emitPageZoom(
    typeof factor === 'number' && Number.isFinite(factor) ? factor : webFrame.getZoomFactor(),
  );
});

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

function reportQaBootstrap() {
  if (!process.env.AGENDEX_DESKTOP_QA_BOOTSTRAP_PATH) return;
  ipcRenderer.send('agendex:qa-bootstrap-observed', {
    href: window.location.href,
    cloudTokenPresent: Boolean(bootstrap.cloudToken),
    convexSiteUrl: bootstrap.convexSiteUrl,
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
  cloudToken: bootstrap.cloudToken,
  convexSiteUrl: bootstrap.convexSiteUrl,
  login: async (provider?: DesktopAuthProvider): Promise<boolean> => {
    const ok = await ipcRenderer.invoke('agendex:login', provider);
    return ok === true;
  },
  logout: async (): Promise<boolean> => {
    const ok = (await ipcRenderer.invoke('agendex:logout')) as boolean;
    agendexDesktop.cloudToken = null;
    agendexDesktop.convexSiteUrl = null;
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
      agendexDesktop.cloudToken = refreshed.token;
      agendexDesktop.convexSiteUrl = refreshed.convexSiteUrl;
      return { token: refreshed.token, convexSiteUrl: refreshed.convexSiteUrl };
    }
    if (refreshed === null) {
      agendexDesktop.cloudToken = null;
      agendexDesktop.convexSiteUrl = null;
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
      agendexDesktop.cloudToken = result.cloudSession.token;
      agendexDesktop.convexSiteUrl = result.cloudSession.convexSiteUrl;
    }
    if (result?.sessionCleared && bootstrap.cloudToken) {
      // The session was revoked and the main process cleared the stored creds.
      // The renderer's copy of this bridge is frozen at expose time
      // (contextBridge copies values), so nulling `cloudToken` here cannot
      // reach it — reload so the page re-bootstraps without the stale token
      // and lands on the sign-in gate.
      agendexDesktop.cloudToken = null;
      agendexDesktop.convexSiteUrl = null;
      window.location.reload();
      return null;
    }
    return typeof result?.token === 'string' && result.token.trim() ? result.token : null;
  },
  authFetch: (url: string, init: DesktopAuthFetchInit): Promise<DesktopAuthFetchResult> =>
    ipcRenderer.invoke('agendex:auth-fetch', url, init),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('agendex:update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('agendex:update:install'),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke('agendex:update:get-state'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('agendex:get-app-version'),
  getBuildInfo: (): Promise<DesktopBuildInfo> => ipcRenderer.invoke('agendex:get-build-info'),
  getPageZoomFactor: (): number => webFrame.getZoomFactor(),
  resetPageZoom: (): void => {
    webFrame.setZoomFactor(1);
    emitPageZoom(1);
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
