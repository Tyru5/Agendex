import type { ElectronAPI } from '@electron-toolkit/preload';

type DesktopAuthProvider = 'github' | 'google';

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

type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'no-update' | 'error';

interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  error?: string;
}

interface AgendexDesktopBridge {
  readonly isDesktop: true;
  readonly cloudToken: string | null;
  readonly convexSiteUrl: string | null;
  login: (provider?: DesktopAuthProvider) => Promise<boolean>;
  logout: () => Promise<boolean>;
  setModePref: (mode: 'local' | 'cloud') => Promise<boolean>;
  refreshCloudSession: () => Promise<{ token: string; convexSiteUrl: string } | null>;
  getConvexAuthToken: () => Promise<string | null>;
  authFetch: (url: string, init: DesktopAuthFetchInit) => Promise<DesktopAuthFetchResult>;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    agendexDesktop: AgendexDesktopBridge;
  }
}

export {};
