import type { ElectronAPI } from '@electron-toolkit/preload';

type DesktopAuthProvider = 'github' | 'google';

interface AgendexDesktopBridge {
  readonly isDesktop: true;
  /** Live getter over the preload session bag — do not assign (contextBridge freezes props). */
  readonly cloudToken: string | null;
  /** Live getter over the preload session bag — do not assign (contextBridge freezes props). */
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
