/**
 * Origin helpers for better-auth trustedOrigins / CORS.
 *
 * Desktop prod serves the EE client from an ephemeral
 * `http://app.agendex.localhost:<port>` origin. better-auth understands
 * `http://*.agendex.localhost:*`, but @convex-dev/better-auth strips trailing
 * `*` when building the CORS allowlist, and convex-helpers only exact-matches
 * origins (plus `*.host` https subdomain wildcards). Reflecting a matching
 * request Origin as an exact string keeps Electron auth fetches working.
 *
 * Only product-owned `*.agendex.localhost` hosts are reflected — never bare
 * `localhost` / `127.0.0.1`, which any local process can use and would otherwise
 * become a trusted browser origin for credentialed auth CORS.
 */

/** Fixed local origins used for Vite / anonymous Convex dev. */
export const LOCAL_DEV_CORS_ORIGINS = [
  'http://agendex.localhost:5174',
  'http://app.agendex.localhost:5174',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
] as const;

/**
 * better-auth origin patterns (port/subdomain wildcards).
 * Not sufficient alone for CORS after trailing-`*` strip.
 */
export const LOCAL_ORIGIN_PATTERNS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'http://agendex.localhost:*',
  'http://*.agendex.localhost:*',
] as const;

/**
 * True for product-owned local HTTP hosts (`agendex.localhost` / subdomains).
 * Used when deciding whether to reflect a request Origin into the CORS
 * exact-match allowlist. Bare loopback hosts are intentionally excluded.
 */
export function isAgendexLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname;
    return host === 'agendex.localhost' || host.endsWith('.agendex.localhost');
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
 * request Origin when it is a product-owned agendex.localhost origin so CORS
 * exact-match accepts Electron's ephemeral desktop ports.
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

  if (requestOrigin && isAgendexLocalOrigin(requestOrigin) && !origins.includes(requestOrigin)) {
    origins.push(requestOrigin);
  }

  return origins;
}
