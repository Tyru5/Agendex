import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };
type Rewrite = { source: string; destination: string };
type VercelConfig = { headers?: HeaderRule[]; rewrites?: Rewrite[] };

const configPath = new URL('../vercel.json', import.meta.url);

async function readConfig(): Promise<VercelConfig> {
  return JSON.parse(await readFile(configPath, 'utf8')) as VercelConfig;
}

async function productionHeaders(): Promise<Map<string, string>> {
  const config = await readConfig();
  const everyRoute = config.headers?.filter((rule) => rule.source === '/(.*)');
  expect(everyRoute).toHaveLength(1);
  return new Map(everyRoute?.[0]?.headers.map(({ key, value }) => [key, value] as const));
}

function parseCsp(value: string): Map<string, string[]> {
  return new Map(
    value.split(';').map((entry) => {
      const [directive, ...sources] = entry.trim().split(/\s+/);
      return [directive, sources] as const;
    }),
  );
}

test('production security headers apply to every route', async () => {
  const headers = await productionHeaders();

  expect(headers.get('Strict-Transport-Security')).toBe(
    'max-age=63072000; includeSubDomains; preload',
  );
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(headers.get('X-Frame-Options')).toBe('DENY');
  expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  expect(headers.get('Permissions-Policy')).toBe(
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  );
});

test('CSP allows required production integrations without an unrestricted wildcard', async () => {
  const headers = await productionHeaders();
  const csp = parseCsp(headers.get('Content-Security-Policy') ?? '');

  expect(csp.get('default-src')).toEqual(["'self'"]);
  expect(csp.get('base-uri')).toEqual(["'self'"]);
  expect(csp.get('object-src')).toEqual(["'none'"]);
  expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  expect(csp.get('script-src')).toEqual(["'self'"]);
  expect(csp.get('style-src')).toEqual(["'self'", 'https://fonts.googleapis.com']);
  expect(csp.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
  expect(csp.get('font-src')).toEqual(["'self'", 'https://fonts.gstatic.com']);
  expect(csp.get('img-src')).toEqual([
    "'self'",
    'data:',
    'blob:',
    'https://*.convex.cloud',
    'https://*.convex.site',
    'https://avatars.githubusercontent.com',
    'https://lh3.googleusercontent.com',
  ]);
  expect(csp.get('connect-src')).toEqual([
    "'self'",
    'https://*.convex.cloud',
    'wss://*.convex.cloud',
    'https://*.convex.site',
    'https://vitals.vercel-insights.com',
  ]);
  expect(csp.get('worker-src')).toEqual(["'self'", 'blob:']);
  expect(csp.get('manifest-src')).toEqual(["'self'"]);

  const wildcardSources = [...csp.values()].flat().filter((source) => source.includes('*'));
  expect(wildcardSources).toEqual([
    'https://*.convex.cloud',
    'https://*.convex.site',
    'https://*.convex.cloud',
    'wss://*.convex.cloud',
    'https://*.convex.site',
  ]);
  expect([...csp.values()].flat()).not.toContain('*');
  expect(csp.get('script-src')).not.toContain("'unsafe-inline'");
  expect(csp.get('script-src')).not.toContain("'unsafe-eval'");
});

test('hashed build assets are cached immutably and never fall back to the SPA shell', async () => {
  const config = await readConfig();
  const assetRules = config.headers?.filter((rule) => rule.source === '/assets/(.*)');

  expect(assetRules).toHaveLength(1);
  expect(assetRules?.[0]?.headers).toEqual([
    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
  ]);
  // A stale chunk must 404 rather than be answered with index.html, which the
  // immutable rule above would otherwise pin in the browser cache.
  expect(config.rewrites?.at(-1)).toEqual({
    source: '/((?!assets/).*)',
    destination: '/index.html',
  });
});
