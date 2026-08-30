import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };
type VercelConfig = { headers?: HeaderRule[] };

const configPath = new URL('../vercel.json', import.meta.url);

async function productionHeaders(): Promise<Map<string, string>> {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as VercelConfig;
  expect(config.headers).toHaveLength(1);
  expect(config.headers?.[0]?.source).toBe('/(.*)');
  return new Map(config.headers?.[0]?.headers.map(({ key, value }) => [key, value] as const));
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
