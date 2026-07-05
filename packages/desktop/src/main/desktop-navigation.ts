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

export function shouldOpenNavigationExternally(appUrl: string, navigationUrl: string): boolean {
  const app = parseUrl(appUrl);
  const next = parseUrl(navigationUrl);
  if (!next || !isHttpUrl(next)) return false;
  if (!app || !isHttpUrl(app)) return true;
  return next.origin !== app.origin;
}
