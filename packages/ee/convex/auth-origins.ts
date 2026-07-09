/**
 * Origin helpers for better-auth trustedOrigins / CORS.
 *
 * Desktop prod serves the EE client from an ephemeral
 * `http://app.agendex.localhost:<port>` origin. better-auth understands
 * `http://app.agendex.localhost:*`, but @convex-dev/better-auth strips trailing
 * `*` when building the CORS allowlist, and convex-helpers only exact-matches
 * origins. Reflecting a matching request Origin as an exact string keeps
 * Electron auth fetches working.
 *
 * Only the two product hostnames used by Vite/Electron are reflected
 * (`agendex.localhost`, `app.agendex.localhost`). Arbitrary
 * `*.agendex.localhost` subdomains are not — any local process can claim those
 * because `*.localhost` resolves to loopback.
 */

/** Fixed local origins used for Vite / anonymous Convex dev. */
export const LOCAL_DEV_CORS_ORIGINS = [
  'http://agendex.localhost:5174',
  'http://app.agendex.localhost:5174',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
] as const;

/**
 * Hostnames allowed for CORS origin reflection (any port).
 * Must match the hosts Vite (`agendex.localhost` / `app.agendex.localhost`)
 * and packaged Electron (`app.agendex.localhost`) actually use.
 */
export const REFLECTABLE_LOCAL_HOSTS = ['agendex.localhost', 'app.agendex.localhost'] as const;

/**
 * better-auth origin patterns (port wildcards on known hosts only).
 * Not sufficient alone for CORS after trailing-`*` strip.
 */
export const LOCAL_ORIGIN_PATTERNS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'http://agendex.localhost:*',
  'http://app.agendex.localhost:*',
] as const;

/**
 * True when the origin is HTTP on an allowlisted product local host
 * (exact hostname match). Used for CORS exact-match reflection.
 */
export function isAgendexLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    return (REFLECTABLE_LOCAL_HOSTS as readonly string[]).includes(url.hostname);
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
 * request Origin when it is an allowlisted product local host so CORS
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
