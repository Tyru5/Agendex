/**
 * HTTP hardening shared by the Bun (`index.ts`) and Node/Electron
 * (`node-server.ts`) entry points: listen host, CORS allowlist, error
 * responses, and security headers for the served client.
 */
import { createHash } from 'node:crypto';
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

type Env = Record<string, string | undefined>;

/** Loopback only by default; `AGENDEX_HOST=0.0.0.0` (or a tailnet IP) exposes the API. */
export const DEFAULT_LISTEN_HOST = '127.0.0.1';

export function resolveListenHost(env: Env = process.env): string {
  return env.AGENDEX_HOST?.trim() || DEFAULT_LISTEN_HOST;
}

/**
 * Browser origins allowed to call the local API cross-origin. Every bundled
 * client calls `/api/v1` relative to its own origin (served here, or through
 * the Vite dev proxy), so these only matter for a dev client calling
 * `:4890` directly. Non-browser callers (CLI, hooks) send no Origin.
 */
export const DEV_CLIENT_ORIGINS = [
  // OSS client (`bun run dev:client:oss`)
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  // EE client and the desktop dev renderer (`bun run dev:client:ee`)
  'http://agendex.localhost:5174',
  'http://app.agendex.localhost:5174',
];

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Dev origins plus `AGENDEX_CORS_ORIGINS` (comma-separated origins). */
export function corsAllowedOrigins(env: Env = process.env): Set<string> {
  const origins = new Set(DEV_CLIENT_ORIGINS);
  for (const entry of parseList(env.AGENDEX_CORS_ORIGINS)) {
    try {
      origins.add(new URL(entry).origin);
    } catch {
      console.warn(`[agendex] ignoring invalid AGENDEX_CORS_ORIGINS entry: ${entry}`);
    }
  }
  return origins;
}

/** `cors({ origin })` resolver: reflect allowlisted and same-origin requests, nothing else. */
export function createCorsOriginResolver(env: Env = process.env) {
  const allowed = corsAllowedOrigins(env);
  return (origin: string, c: Context): string | null => {
    if (!origin) return null;
    if (allowed.has(origin)) return origin;
    return origin === new URL(c.req.url).origin ? origin : null;
  };
}

/** Malformed JSON bodies are client errors; anything else is a 500 without internals. */
export const handleAppError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400);
  console.error(`[agendex] ${c.req.method} ${c.req.path} failed:`, error);
  return c.json({ error: 'Internal server error' }, 500);
};

/** sha256 sources for inline `<script>` blocks, so `script-src` needs no 'unsafe-inline'. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    if (/\bsrc\s*=/i.test(attributes) || !body) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return [...hashes];
}

/**
 * Mirrors the cloud policy in `vercel.json`, adjusted for the local server:
 * WebSockets to this host, inline theme-script hashes, remote images in plan
 * markdown, and `AGENDEX_CSP_CONNECT_SRC` for self-hosted Convex/site hosts.
 */
export function buildContentSecurityPolicy(scriptHashes: string[], env: Env = process.env): string {
  const connectSrc = [
    "'self'",
    'ws:',
    'wss:',
    // EE dashboard bundle (desktop) talks to Convex and Vercel insights.
    'https://*.convex.cloud',
    'https://*.convex.site',
    'https://vitals.vercel-insights.com',
    ...parseList(env.AGENDEX_CSP_CONNECT_SRC),
  ];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self'${scriptHashes.map((hash) => ` ${hash}`).join('')}`,
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    // Plans are local markdown and may embed images from any https host.
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}

/** Security headers for the static client; register just before the static catch-all. */
export function createStaticSecurityHeaders(env: Env = process.env): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    const isHtml = headers.get('Content-Type')?.startsWith('text/html') ?? false;
    const hashes = isHtml ? inlineScriptHashes(await c.res.clone().text()) : [];
    headers.set('Content-Security-Policy', buildContentSecurityPolicy(hashes, env));
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set(
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    );
  };
}
