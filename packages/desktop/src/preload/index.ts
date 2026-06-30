import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge, ipcRenderer } from 'electron';

interface Bootstrap {
  localToken: string | null;
  cloudToken: string | null;
  convexSiteUrl: string | null;
  modePref: 'local' | 'cloud' | null;
}

const MODE_PREF_KEY = 'agendex_dashboard_mode';

function readBootstrap(): Bootstrap {
  try {
    return ipcRenderer.sendSync('agendex:get-bootstrap') as Bootstrap;
  } catch (err) {
    console.error('[agendex-desktop] failed to read bootstrap', err);
    return { localToken: null, cloudToken: null, convexSiteUrl: null, modePref: null };
  }
}

const bootstrap = readBootstrap();

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
    console.error('[agendex-desktop] failed to inject local token', err);
  }
}

function injectDesktopPrefs() {
  injectLocalToken();
  if (!bootstrap.modePref) return;
  try {
    window.localStorage.setItem(MODE_PREF_KEY, bootstrap.modePref);
  } catch (err) {
    console.error('[agendex-desktop] failed to inject mode preference', err);
  }
}

// The cloud session bridge: exposes the session token (used as a Bearer
// credential by the EE client) plus the system-browser login/logout flows.
const agendexDesktop = {
  isDesktop: true as const,
  cloudToken: bootstrap.cloudToken,
  convexSiteUrl: bootstrap.convexSiteUrl,
  login: (): Promise<boolean> => ipcRenderer.invoke('agendex:login'),
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
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('agendexDesktop', agendexDesktop);
  } catch (err) {
    console.error(err);
  }
} else {
  // @ts-expect-error define on window when context isolation is disabled
  window.electron = electronAPI;
  // @ts-expect-error define on window when context isolation is disabled
  window.agendexDesktop = agendexDesktop;
}

injectDesktopPrefs();
