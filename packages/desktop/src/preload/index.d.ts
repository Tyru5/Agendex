import type { ElectronAPI } from '@electron-toolkit/preload';

interface AgendexDesktopBridge {
  readonly isDesktop: true;
  readonly cloudToken: string | null;
  readonly convexSiteUrl: string | null;
  login: () => Promise<boolean>;
  logout: () => Promise<boolean>;
  setModePref: (mode: 'local' | 'cloud') => Promise<boolean>;
  refreshCloudSession: () => Promise<{ token: string; convexSiteUrl: string } | null>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    agendexDesktop: AgendexDesktopBridge;
  }
}

export {};
