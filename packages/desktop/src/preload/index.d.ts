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

type WindowsAgentEnv = 'native' | 'wsl';

interface WindowsEnvStatus {
  env: WindowsAgentEnv;
  wslAvailable: boolean;
  wslDistroName: string | null;
  wslHomePath: string | null;
  error?: string;
}

interface WindowsEnvSetResult extends WindowsEnvStatus {
  ok: boolean;
  willRelaunch: boolean;
}

type DesktopDaemonState =
  | { status: 'idle' }
  | { status: 'starting'; message?: string }
  | { status: 'indexing'; message?: string }
  | { status: 'ready' }
  | { status: 'stopping' }
  | { status: 'error'; message: string };

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
  getUpdateState: () => Promise<UpdateState>;
  getAppVersion: () => Promise<string>;
  getDaemonState: () => Promise<DesktopDaemonState>;
  getWindowsEnv?: () => Promise<WindowsEnvStatus | null>;
  setWindowsEnv?: (env: WindowsAgentEnv) => Promise<WindowsEnvSetResult | null>;
  getPageZoomFactor: () => number;
  resetPageZoom: () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    agendexDesktop: AgendexDesktopBridge;
  }
}

export {};
