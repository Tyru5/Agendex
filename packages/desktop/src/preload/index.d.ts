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
}

declare global {
  interface Window {
    electron: ElectronAPI;
    agendexDesktop: AgendexDesktopBridge;
  }
}

export {};
