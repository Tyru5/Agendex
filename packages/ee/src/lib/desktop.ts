/**
 * Desktop (Electron) integration bridge.
 *
 * The Electron preload exposes `window.agendexDesktop` via `contextBridge`. When
 * present, the EE client runs inside the desktop app and authenticates against
 * the cloud using a session token obtained through the system-browser loopback
 * login flow (mirrors `agendex login` in the CLI). The token is used as a Bearer
 * credential, and the Convex deployment URLs are derived from the Convex *site*
 * URL returned by that flow — so the desktop build needs no baked Convex env.
 */

export interface AgendexDesktopBridge {
  readonly isDesktop: true;
  cloudToken: string | null;
  convexSiteUrl: string | null;
  login: () => Promise<boolean>;
  logout: () => Promise<boolean>;
  setModePref: (mode: 'local' | 'cloud') => Promise<boolean>;
  refreshCloudSession: () => Promise<{ token: string; convexSiteUrl: string } | null>;
}

function getBridge(): AgendexDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { agendexDesktop?: AgendexDesktopBridge }).agendexDesktop;
}

export function isDesktop(): boolean {
  return getBridge()?.isDesktop === true;
}

export function getDesktopCloudToken(): string | null {
  return getBridge()?.cloudToken ?? null;
}

export function getDesktopConvexSiteUrl(): string | null {
  return getBridge()?.convexSiteUrl ?? null;
}

/**
 * Derives the Convex deployment (`.convex.cloud`) URL from the Convex site
 * (`.convex.site`) URL returned by the loopback login. Both are minted from the
 * same deployment, so the swap is deterministic.
 */
export function getDesktopConvexCloudUrl(): string | null {
  const siteUrl = getDesktopConvexSiteUrl();
  if (!siteUrl) return null;
  return siteUrl.replace('.convex.site', '.convex.cloud');
}

/** Opens the system-browser sign-in flow, then reloads to pick up the session. */
export async function desktopLogin(): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  const ok = await bridge.login();
  if (ok && typeof window !== 'undefined') window.location.reload();
  return ok;
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
