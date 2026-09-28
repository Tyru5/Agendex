/**
 * Cache policy for served client files.
 *
 * Vite emits content-hashed filenames under `/assets/`, so those are safe to
 * cache indefinitely. Everything else — above all `index.html`, which names the
 * current asset hashes — must not be cached: when the desktop app swaps in a
 * downloaded UI bundle, a stale document would reference asset hashes that no
 * longer exist in the new bundle.
 */
export function cacheControlFor(pathname: string): string {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.endsWith('.html')) return 'no-store';
  return 'no-cache';
}
