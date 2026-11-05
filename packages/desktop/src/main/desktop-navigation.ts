function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export function shouldOpenWindowExternally(url: string): boolean {
  const parsed = parseUrl(url);
  return Boolean(parsed && isHttpUrl(parsed));
}

export type NavigationAction = 'allow' | 'open-externally' | 'block';

/**
 * Decides what to do with a main-window navigation or redirect: stay in the app
 * only for same-origin http(s) URLs, hand other http(s) URLs to the system
 * browser, and block everything else (file:, javascript:, data:, custom schemes).
 */
export function resolveNavigationAction(appUrl: string, navigationUrl: string): NavigationAction {
  const next = parseUrl(navigationUrl);
  if (!next || !isHttpUrl(next)) return 'block';
  const app = parseUrl(appUrl);
  if (app && isHttpUrl(app) && next.origin === app.origin) return 'allow';
  return 'open-externally';
}
