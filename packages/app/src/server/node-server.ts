import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { stopWatchingForShutdown } from '@agendex/shared';
import { serve, type ServerType } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { buildAgendexApp } from './app.ts';

export interface StartNodeServerOptions {
  /** Port to listen on. Use `0` for an ephemeral free port. Defaults to `0`. */
  port?: number;
  /**
   * Absolute path to the built client directory (`packages/app/src/client/dist`),
   * or a resolver invoked per request. The desktop app passes a resolver so a
   * downloaded UI bundle can be swapped in and picked up on the next page load
   * without restarting the server.
   */
  clientDistDir: string | (() => string);
  /** Hostname to bind. Defaults to `127.0.0.1`. */
  hostname?: string;
}

export interface RunningNodeServer {
  port: number;
  token: string;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  const ext = dot === -1 ? '' : filePath.slice(dot).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Resolves a request pathname to a file inside `rootDir`, guarding against path
 * traversal. Returns the absolute file path if it points to an existing file.
 */
function resolveStaticFile(rootDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding (e.g. `/%`) — treat as not found rather than
    // letting the URIError bubble up and crash the request handler.
    return null;
  }
  const rel = decoded.replace(/^\/+/, '');
  const candidate = normalize(join(rootDir, rel));
  const rootWithSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  if (candidate !== rootDir && !candidate.startsWith(rootWithSep)) return null;
  if (!existsSync(candidate)) return null;
  const stat = statSync(candidate);
  if (!stat.isFile()) return null;
  return candidate;
}

/**
 * True when the path looks like a known static asset (JS/CSS/image/font/…),
 * not a client-side route. SPA fallback must still apply to routes whose path
 * segments merely contain dots (e.g. `/shared/abc.def`, `/invite/token.with.dots`).
 * Missing real assets (e.g. `/_vercel/insights/script.js`) must 404 instead of
 * returning `index.html` (which browsers then try to execute as JS).
 */
function looksLikeAssetPath(pathname: string): boolean {
  const lastSegment = pathname.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = lastSegment.slice(dot).toLowerCase();
  return MIME_TYPES[ext] !== undefined;
}

/**
 * Cache policy for served client files.
 *
 * Vite emits content-hashed filenames under `/assets/`, so those are safe to
 * cache indefinitely. Everything else — above all `index.html`, which names the
 * current asset hashes — must not be cached: when the desktop app swaps in a
 * downloaded UI bundle, a stale document would reference asset hashes that no
 * longer exist in the new bundle.
 */
function cacheControlFor(pathname: string): string {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.endsWith('.html')) return 'no-store';
  return 'no-cache';
}

/**
 * Serves the built client with an SPA fallback to `index.html`. Avoids
 * serveStatic `root` resolution quirks so packaged Electron apps (unpredictable
 * cwd) work cross-platform.
 *
 * The root is resolved per request rather than captured once, so the desktop
 * shell can activate a different UI bundle directory and have it take effect on
 * the next reload with no server restart. Each request already touches the
 * filesystem, so this costs nothing extra.
 */
function mountStaticFromDir(app: Hono, resolveClientDistDir: () => string) {
  app.get('/*', (c) => {
    const pathname = new URL(c.req.url).pathname;
    const clientDistDir = resolveClientDistDir();
    const file = resolveStaticFile(clientDistDir, pathname);

    if (file) {
      const body = readFileSync(file);
      return c.body(body, 200, {
        'Content-Type': contentTypeFor(file),
        'Cache-Control': cacheControlFor(pathname),
      });
    }

    // Missing asset paths must not SPA-fallback: that turns 404s into HTML
    // payloads executed as scripts (`Unexpected token '<'`).
    if (looksLikeAssetPath(pathname)) {
      return c.text('Not found', 404);
    }

    const indexPath = join(clientDistDir, 'index.html');
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath);
      return c.body(html, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    }

    return c.text('Not found', 404);
  });
}

/**
 * Boots the Agendex backend on Node (Electron's runtime). Serves the API,
 * WebSocket, and the built client from one origin.
 */
export function startNodeServer(options: StartNodeServerOptions): Promise<RunningNodeServer> {
  const { port = 0, clientDistDir, hostname = '127.0.0.1' } = options;
  const resolveClientDistDir =
    typeof clientDistDir === 'function' ? clientDistDir : () => clientDistDir;

  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  const { token, ready } = buildAgendexApp({
    app,
    upgradeWebSocket,
    mountStatic: (a) => mountStaticFromDir(a, resolveClientDistDir),
  });

  return new Promise<RunningNodeServer>((resolve, reject) => {
    let server: ServerType;
    try {
      server = serve({ fetch: app.fetch, port, hostname }, (info) => {
        void ready
          .then(() => {
            resolve({
              port: info.port,
              token,
              close: () =>
                new Promise<void>((res) => {
                  stopWatchingForShutdown();
                  server.close(() => res());
                }),
            });
          })
          .catch((err) => {
            server.close(() => {
              reject(err instanceof Error ? err : new Error(String(err)));
            });
          });
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    injectWebSocket(server);
    server.on('error', reject);
  });
}
