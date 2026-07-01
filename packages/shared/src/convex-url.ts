const CONVEX_SITE_HOST_PATTERN = /^[a-z0-9-]+\.convex\.site$/i;
const LOCAL_CONVEX_SITE_PORT = '3211';
const LOCAL_CONVEX_DEPLOYMENT_PORT = '3210';

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function isProductionConvexSiteUrl(url: URL): boolean {
  return url.protocol === 'https:' && CONVEX_SITE_HOST_PATTERN.test(url.hostname);
}

function isLocalConvexSiteUrl(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    isLoopbackHostname(url.hostname) &&
    url.port === LOCAL_CONVEX_SITE_PORT
  );
}

export function normalizeConvexSiteUrl(value: string): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  if (!isProductionConvexSiteUrl(url) && !isLocalConvexSiteUrl(url)) return null;
  return url.origin;
}

export function deriveConvexDeploymentUrl(siteUrl: string): string | null {
  const normalizedSiteUrl = normalizeConvexSiteUrl(siteUrl);
  if (!normalizedSiteUrl) return null;

  const url = new URL(normalizedSiteUrl);
  if (isLocalConvexSiteUrl(url)) {
    url.port = LOCAL_CONVEX_DEPLOYMENT_PORT;
    return url.origin;
  }

  return normalizedSiteUrl.replace(/\.convex\.site$/i, '.convex.cloud');
}
