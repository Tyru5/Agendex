import type { ElectronAPI } from '@electron-toolkit/preload';

type DesktopAuthProvider = 'github' | 'google';

interface AgendexDesktopBridge {
  readonly isDesktop: true;
  readonly cloudToken: string | null;
  readonly convexSiteUrl: string | null;
  login: (provider?: DesktopAuthProvider) => Promise<boolean>;
  logout: () => Promise<boolean>;
  setModePref: (mode: 'local' | 'cloud') => Promise<boolean>;
  refreshCloudSession: () => Promise<{ token: string; convexSiteUrl: string } | null>;
  getConvexAuthToken: () => Promise<string | null>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    agendexDesktop: AgendexDesktopBridge;
  }
}

export {};
