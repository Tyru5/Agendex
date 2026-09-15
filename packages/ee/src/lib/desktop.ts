import { deriveConvexDeploymentUrl } from '@agendex/shared/convex-url';

export type DesktopAuthProvider = 'github' | 'google';

export type DesktopAuthFetchInit = {
  readonly method: string;
  readonly headers: readonly [string, string][];
  readonly body: string | null;
};

export type DesktopAuthFetchResult = {
  readonly body: string | null;
  readonly headers: readonly [string, string][];
  readonly status: number;
  readonly statusText: string;
};

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'no-update'
  | 'error'
  // Dev/unpackaged builds and the Windows portable exe cannot self-update.
  | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  error?: string;
}

/**
 * State of the UI-only updater, which swaps the client bundle the desktop's
 * local server serves without replacing the Electron app.
 */
export interface UiUpdateState {
  status: UpdateStatus;
  /** Git commit timestamp of the staged bundle. */
  revision?: number;
  label?: string;
  progress?: number;
  error?: string;
}

/** Build identity of the running desktop app, used to surface unsigned builds. */
export interface DesktopBuildInfo {
  /** process.platform of the running app ('win32', 'darwin', ...). */
  platform: string;
  /**
   * Whether the build carries a code-signing certificate. `null` when unknown:
   * dev builds, and platforms that record no signing evidence in app-update.yml.
   */
  codeSigned: boolean | null;
}

/** Windows desktop only: which OS environment supplies agent plan roots. */
export type WindowsAgentEnv = 'native' | 'wsl';

export interface WindowsEnvStatus {
  env: WindowsAgentEnv;
  wslAvailable: boolean;
  wslDistroName: string | null;
  wslHomePath: string | null;
  error?: string;
}

export interface WindowsEnvSetResult extends WindowsEnvStatus {
  ok: boolean;
  willRelaunch: boolean;
}

export type DesktopDaemonState =
  | { status: 'idle' }
  | { status: 'starting'; message?: string }
  | { status: 'indexing'; message?: string }
  | { status: 'ready' }
  | { status: 'stopping' }
  | { status: 'error'; message: string };

/**
 * Desktop (Electron) integration bridge.
 *
 * The Electron preload exposes `window.agendexDesktop` via `contextBridge`. When
 * present, the EE client runs inside the desktop app and authenticates against
 * the cloud using a session token obtained through the system-browser loopback
 * login flow (mirrors `agendex login` in the CLI). The token is used as a Bearer
 * credential, and the Convex deployment URLs are derived from the Convex site
 * URL returned by that flow, so the desktop build needs no baked Convex env.
 */

export interface AgendexDesktopBridge {
  readonly isDesktop: true;
  readonly cloudToken: string | null;
  readonly convexSiteUrl: string | null;
  login: (provider?: DesktopAuthProvider) => Promise<boolean>;
  logout: () => Promise<boolean>;
  setModePref: (mode: 'local' | 'cloud') => Promise<boolean>;
  refreshCloudSession: () => Promise<{ token: string; convexSiteUrl: string } | null>;
  getConvexAuthToken: () => Promise<string | null>;
  authFetch: (url: string, init: DesktopAuthFetchInit) => Promise<DesktopAuthFetchResult>;
  storeObfuscationKey?: (
    workspaceOwnerId: string,
    keyEpoch: number,
    keyBase64: string,
  ) => Promise<boolean>;
  loadObfuscationKey?: (workspaceOwnerId: string, keyEpoch: number) => Promise<string | null>;
  clearObfuscationKey?: (workspaceOwnerId: string, keyEpoch: number) => Promise<boolean>;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getUpdateState: () => Promise<UpdateState>;
  getAppVersion: () => Promise<string>;
  getBuildInfo: () => Promise<DesktopBuildInfo>;
  getDaemonState?: () => Promise<DesktopDaemonState>;
  getPageZoomFactor?: () => number;
  resetPageZoom?: () => void;
  // UI-bundle updates. Optional: a shell older than this feature has no such
  // methods, and the UI must keep working there.
  checkForUiUpdates?: () => Promise<void>;
  applyUiUpdate?: () => Promise<void>;
  getUiUpdateState?: () => Promise<UiUpdateState>;
  getUiRevision?: () => Promise<number>;
  getUiVersion?: () => Promise<string>;
  signalUiReady?: () => void;
  // Windows desktop only: agent plan root environment (native vs WSL).
  getWindowsEnv?: () => Promise<WindowsEnvStatus | null>;
  setWindowsEnv?: (env: WindowsAgentEnv) => Promise<WindowsEnvSetResult | null>;
}

function getBridge(): AgendexDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { agendexDesktop?: AgendexDesktopBridge }).agendexDesktop;
}

export function isDesktop(): boolean {
  return getBridge()?.isDesktop === true;
}

export async function storeDesktopObfuscationKey(
  workspaceOwnerId: string,
  keyEpoch: number,
  keyBase64: string,
): Promise<boolean> {
  return (await getBridge()?.storeObfuscationKey?.(workspaceOwnerId, keyEpoch, keyBase64)) ?? false;
}

export async function loadDesktopObfuscationKey(
  workspaceOwnerId: string,
  keyEpoch: number,
): Promise<string | null> {
  return (await getBridge()?.loadObfuscationKey?.(workspaceOwnerId, keyEpoch)) ?? null;
}

export async function clearDesktopObfuscationKey(
  workspaceOwnerId: string,
  keyEpoch: number,
): Promise<void> {
  await getBridge()?.clearObfuscationKey?.(workspaceOwnerId, keyEpoch);
}

/** Dispatched by the desktop preload when Electron page zoom changes. */
export const DESKTOP_PAGE_ZOOM_EVENT = 'agendex:page-zoom';

export function getDesktopPageZoomFactor(): number {
  return getBridge()?.getPageZoomFactor?.() ?? 1;
}

export function resetDesktopPageZoom(): void {
  getBridge()?.resetPageZoom?.();
}

/** Subscribe to desktop page-zoom changes. No-op outside the desktop bridge. */
export function subscribeDesktopPageZoom(listener: (factor: number) => void): () => void {
  if (typeof window === 'undefined' || !isDesktop()) return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    listener(
      typeof detail === 'number' && Number.isFinite(detail) ? detail : getDesktopPageZoomFactor(),
    );
  };

  window.addEventListener(DESKTOP_PAGE_ZOOM_EVENT, handler);
  return () => window.removeEventListener(DESKTOP_PAGE_ZOOM_EVENT, handler);
}

export function normalizeDesktopAuthProvider(provider: unknown): DesktopAuthProvider | undefined {
  return provider === 'github' || provider === 'google' ? provider : undefined;
}

export function getDesktopCloudToken(): string | null {
  return getBridge()?.cloudToken ?? null;
}

export function getDesktopConvexSiteUrl(): string | null {
  return getBridge()?.convexSiteUrl ?? null;
}

/**
 * Derives the Convex deployment URL from the site URL returned by login.
 * Production swaps `.convex.site` to `.convex.cloud`; local anonymous Convex
 * swaps the site port 3211 to the deployment port 3210.
 */
export function getDesktopConvexCloudUrl(): string | null {
  const siteUrl = getDesktopConvexSiteUrl();
  if (!siteUrl) return null;
  return deriveConvexDeploymentUrl(siteUrl);
}

export async function desktopLogin(provider?: DesktopAuthProvider): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  try {
    const ok = await bridge.login(provider);
    if (!ok) return false;
    if (typeof window !== 'undefined') window.location.reload();
    return true;
  } catch (err) {
    if (err instanceof Error) {
      console.error('[agendex-desktop] login bridge failed', err);
    } else {
      console.error('[agendex-desktop] login bridge failed', String(err));
    }
    return false;
  }
}

/**
 * Clears the stored cloud session in the main process. Does not navigate —
 * callers decide whether to reload.
 *
 * `contextBridge` freezes the exposed object at inject time; a full reload is
 * required for the preload to re-bootstrap without a token. Always clear
 * main-process creds first so that reload cannot re-read a revoked session
 * from disk.
 */
export async function clearDesktopCloudSession(): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  await bridge.logout();
}

/** Clears the stored cloud session and reloads into the dashboard sign-in gate. */
export async function desktopLogout(): Promise<void> {
  await clearDesktopCloudSession();
  if (typeof window === 'undefined') return;

  const dashboard = new URL('/dashboard', window.location.origin);
  if (window.location.pathname === dashboard.pathname) {
    window.location.reload();
    return;
  }
  window.location.href = dashboard.href;
}

/** Persists local/cloud mode outside origin-scoped localStorage (ephemeral desktop ports). */
export async function setDesktopModePref(mode: 'local' | 'cloud'): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  await bridge.setModePref(mode);
}

/** Refreshes the stored cloud session token via the main process. */
export async function refreshDesktopCloudSession(): Promise<string | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  const refreshed = await bridge.refreshCloudSession();
  return refreshed?.token ?? null;
}

export async function getDesktopConvexAuthToken(): Promise<string | null> {
  const bridge = getBridge();
  if (!bridge?.cloudToken || !bridge.convexSiteUrl) return null;
  return bridge.getConvexAuthToken();
}

export async function desktopBridgeAuthFetch(
  url: string,
  init: DesktopAuthFetchInit,
): Promise<DesktopAuthFetchResult | null> {
  const bridge = getBridge();
  return bridge ? bridge.authFetch(url, init) : null;
}

export function getDesktopBridgeIdentity(): AgendexDesktopBridge | undefined {
  return getBridge();
}

/** Dispatched by the desktop preload when the bundled sync service changes state. */
export const DESKTOP_DAEMON_STATE_EVENT = 'agendex:daemon-state';

export async function getDesktopDaemonState(): Promise<DesktopDaemonState | null> {
  const bridge = getBridge();
  if (!bridge?.getDaemonState) return null;
  try {
    return await bridge.getDaemonState();
  } catch (err) {
    console.error('[agendex-desktop] failed to read daemon state', err);
    return null;
  }
}

export function subscribeDesktopDaemonState(
  listener: (state: DesktopDaemonState) => void,
): () => void {
  if (typeof window === 'undefined' || !isDesktop()) return () => {};
  const handler = (event: Event) => {
    const state = (event as CustomEvent<DesktopDaemonState>).detail;
    if (state && typeof state.status === 'string') listener(state);
  };
  window.addEventListener(DESKTOP_DAEMON_STATE_EVENT, handler);
  return () => window.removeEventListener(DESKTOP_DAEMON_STATE_EVENT, handler);
}

export async function getDesktopWindowsEnv(): Promise<WindowsEnvStatus | null> {
  const bridge = getBridge();
  if (!bridge?.getWindowsEnv) return null;
  try {
    return await bridge.getWindowsEnv();
  } catch (err) {
    console.error('[agendex-desktop] failed to read windows env', err);
    return null;
  }
}

export async function setDesktopWindowsEnv(
  env: WindowsAgentEnv,
): Promise<WindowsEnvSetResult | null> {
  const bridge = getBridge();
  if (!bridge?.setWindowsEnv) return null;
  try {
    return await bridge.setWindowsEnv(env);
  } catch (err) {
    console.error('[agendex-desktop] failed to set windows env', err);
    return null;
  }
}

/** Dispatched by the desktop preload when the UI-bundle updater changes state. */
export const DESKTOP_UI_UPDATE_STATE_EVENT = 'agendex:ui-update:state';

/**
 * Tells the desktop shell this bundle rendered successfully.
 *
 * The shell reverts to the UI it shipped with if a freshly activated bundle
 * never signals within its boot window, so this is what stops a working update
 * from being rolled back. Safe to call outside the desktop app (no-op).
 */
export function signalDesktopUiReady(): void {
  try {
    getBridge()?.signalUiReady?.();
  } catch (err) {
    console.error('[agendex-desktop] failed to signal UI ready', err);
  }
}
