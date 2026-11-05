import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createCorsOriginResolver,
  createStaticSecurityHeaders,
  handleAppError,
  inlineScriptHashes,
  resolveListenHost,
} from './http-security.ts';

describe('http security', () => {
  test('listens on loopback unless AGENDEX_HOST overrides it', () => {
    expect(resolveListenHost({})).toBe('127.0.0.1');
    expect(resolveListenHost({ AGENDEX_HOST: ' 0.0.0.0 ' })).toBe('0.0.0.0');
  });

  test('reflects only allowlisted and same origins', async () => {
    const app = new Hono();
    app.use(
      '*',
      cors({ origin: createCorsOriginResolver({ AGENDEX_CORS_ORIGINS: 'https://x.dev/' }) }),
    );
    app.get('/', (c) => c.text('ok'));
    const allow = async (origin: string) =>
      (await app.request('http://127.0.0.1:4890/', { headers: { Origin: origin } })).headers.get(
        'Access-Control-Allow-Origin',
      );
    expect(await allow('http://localhost:5173')).toBe('http://localhost:5173');
    expect(await allow('http://app.agendex.localhost:5174')).toBe(
      'http://app.agendex.localhost:5174',
    );
    expect(await allow('https://x.dev')).toBe('https://x.dev');
    expect(await allow('http://127.0.0.1:4890')).toBe('http://127.0.0.1:4890');
    expect(await allow('https://evil.example')).toBeNull();
  });

  test('maps malformed JSON to 400 and other errors to a bare 500', async () => {
    const app = new Hono();
    app.onError(handleAppError);
    app.post('/json', async (c) => c.json(await c.req.json()));
    app.get('/boom', () => {
      throw new Error('secret internals');
    });
    const bad = await app.request('/json', { method: 'POST', body: '{' });
    expect(bad.status).toBe(400);
    const original = console.error;
    console.error = () => {};
    try {
      const boom = await app.request('/boom');
      expect(boom.status).toBe(500);
      expect(await boom.text()).not.toContain('secret internals');
    } finally {
      console.error = original;
    }
  });

  test('static HTML gets a CSP that allows its inline scripts by hash', async () => {
    const html = '<script>console.log(1)</script><script type="module" src="/a.js"></script>';
    expect(inlineScriptHashes(html)).toHaveLength(1);
    const app = new Hono();
    app.use('*', createStaticSecurityHeaders({}));
    app.get('/', (c) => c.html(html));
    const res = await app.request('/');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(inlineScriptHashes(html)[0] ?? 'missing hash');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe(html);
  });
});
