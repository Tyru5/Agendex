import type { AgendexDesktopBridge, UpdateState } from './desktop.ts';

const UPDATE_STATE_EVENT = 'agendex:update:state';
export const UPDATE_UI_DEMO_PARAM = 'updateUiDemo';
const UPDATE_UI_DEMO_STORAGE_KEY = 'agendex_update_ui_demo';

declare global {
  interface Window {
    __agendexUpdateDemo?: {
      setState: (state: UpdateState) => void;
      playScript: () => Promise<void>;
    };
  }
}

export function isUpdateUiDemo(): boolean {
  if (typeof window === 'undefined') return false;
  if (!import.meta.env.DEV) return false;
  if (new URLSearchParams(window.location.search).has(UPDATE_UI_DEMO_PARAM)) {
    try {
      sessionStorage.setItem(UPDATE_UI_DEMO_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    return true;
  }
  try {
    return sessionStorage.getItem(UPDATE_UI_DEMO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function dispatchUpdateState(state: UpdateState) {
  window.dispatchEvent(new CustomEvent<UpdateState>(UPDATE_STATE_EVENT, { detail: state }));
}

/**
 * DEV-only: install a mock Electron preload bridge so UpdateIndicator / UpdateTab
 * render inside the real EE dashboard + settings chrome without a desktop build.
 */
export function installUpdateUiDemoBridge(): boolean {
  if (!isUpdateUiDemo()) return false;

  const existing = (window as Window & { agendexDesktop?: AgendexDesktopBridge }).agendexDesktop;
  if (existing?.isDesktop) {
    document.documentElement.dataset.agendexDesktop = 'true';
    return true;
  }

  let latest: UpdateState = { status: 'idle' };

  const bridge: AgendexDesktopBridge = {
    isDesktop: true,
    cloudToken: null,
    convexSiteUrl: null,
    login: async () => false,
    logout: async () => true,
    setModePref: async () => true,
    refreshCloudSession: async () => null,
    getConvexAuthToken: async () => null,
    authFetch: async () => ({
      body: null,
      headers: [],
      status: 501,
      statusText: 'Not Implemented',
    }),
    checkForUpdates: async () => {
      latest = { status: 'checking' };
      dispatchUpdateState(latest);
      await new Promise((r) => setTimeout(r, 1200));
      latest = { status: 'downloading', version: '0.4.2', progress: 8 };
      dispatchUpdateState(latest);
      for (const progress of [22, 41, 58, 74, 91, 100]) {
        await new Promise((r) => setTimeout(r, 700));
        latest = { status: 'downloading', version: '0.4.2', progress };
        dispatchUpdateState(latest);
      }
      await new Promise((r) => setTimeout(r, 500));
      latest = { status: 'ready', version: '0.4.2', progress: 100 };
      dispatchUpdateState(latest);
    },
    installUpdate: async () => {
      latest = { status: 'idle' };
      dispatchUpdateState(latest);
    },
    getAppVersion: async () => '0.4.1',
  };

  Object.defineProperty(window, 'agendexDesktop', {
    value: bridge,
    configurable: true,
    writable: true,
  });

  document.documentElement.dataset.agendexDesktop = 'true';

  window.__agendexUpdateDemo = {
    setState: (state) => {
      latest = state;
      dispatchUpdateState(state);
    },
    playScript: async () => {
      await bridge.checkForUpdates();
    },
  };

  return true;
}
