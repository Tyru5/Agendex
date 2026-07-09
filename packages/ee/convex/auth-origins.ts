/**
 * Origin helpers for better-auth trustedOrigins / CORS.
 *
 * Desktop prod serves the EE client from an ephemeral `http://localhost:<port>`
 * origin. better-auth understands `http://localhost:*`, but @convex-dev/better-auth
 * strips trailing `*` when building the CORS allowlist, and convex-helpers only
 * exact-matches origins (plus `*.host` https subdomain wildcards). Reflecting a
 * matching request Origin as an exact string keeps Electron auth fetches working.
 */

/** Fixed local origins used for Vite / anonymous Convex dev. */
export const LOCAL_DEV_CORS_ORIGINS = [
  'http://agendex.localhost:5174',
  'http://app.agendex.localhost:5174',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
] as const;

/** better-auth patterns (port/subdomain wildcards). Not sufficient alone for CORS. */
export const LOCAL_ORIGIN_PATTERNS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'http://agendex.localhost:*',
  'http://*.agendex.localhost:*',
] as const;

/**
 * True for loopback / agendex.localhost HTTP origins (any port), i.e. local web
 * dev and packaged Electron which binds an ephemeral localhost port.
 */
export function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === 'agendex.localhost' ||
      host.endsWith('.agendex.localhost')
    );
  } catch {
    return false;
  }
}

export type TrustedOriginsInput = {
  siteUrl: string;
  appUrl: string;
  /** Incoming request Origin header (may be null/undefined). */
  requestOrigin?: string | null;
};

/**
 * Builds the trustedOrigins list for better-auth, optionally reflecting the
 * request Origin when it is a known local/desktop origin so CORS exact-match
 * accepts Electron's ephemeral localhost ports.
 */
export function buildTrustedOrigins({
  siteUrl,
  appUrl,
  requestOrigin,
}: TrustedOriginsInput): string[] {
  const wwwVariant =
    siteUrl && siteUrl.includes('://www.')
      ? siteUrl.replace('://www.', '://')
      : siteUrl
        ? `${siteUrl.replace('://', '://www.')}`
        : '';

  const origins = [
    siteUrl,
    wwwVariant,
    appUrl,
    'https://*.vercel.app',
    ...LOCAL_ORIGIN_PATTERNS,
  ].filter((value): value is string => Boolean(value));

  if (requestOrigin && isLocalDevOrigin(requestOrigin) && !origins.includes(requestOrigin)) {
    origins.push(requestOrigin);
  }

  return origins;
}
