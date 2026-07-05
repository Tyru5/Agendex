import { deriveConvexDeploymentUrl } from '@agendex/shared/convex-url';

export type DesktopAuthProvider = 'github' | 'google';

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
  cloudToken: string | null;
  convexSiteUrl: string | null;
  login: (provider?: DesktopAuthProvider) => Promise<boolean>;
  logout: () => Promise<boolean>;
  setModePref: (mode: 'local' | 'cloud') => Promise<boolean>;
  refreshCloudSession: () => Promise<{ token: string; convexSiteUrl: string } | null>;
  getConvexAuthToken: () => Promise<string | null>;
}

function getBridge(): AgendexDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { agendexDesktop?: AgendexDesktopBridge }).agendexDesktop;
}

export function isDesktop(): boolean {
  return getBridge()?.isDesktop === true;
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

/** Clears the stored cloud session and reloads into the dashboard sign-in gate. */
export async function desktopLogout(): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  await bridge.logout();
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
