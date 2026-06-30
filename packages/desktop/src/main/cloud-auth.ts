import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { app, safeStorage, shell } from 'electron';

/** Cloud session captured from the system-browser loopback login. */
export interface CloudCreds {
  /** better-auth session token, used as a Bearer credential by the EE client. */
  token: string;
  /** Convex *site* URL (`https://<id>.convex.site`); the `.convex.cloud` URL is derived from it. */
  convexSiteUrl: string;
}

const PROD_SITE_URL = 'https://app.agendex.dev';
const DEV_SITE_URL = 'http://app.agendex.localhost:5174';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Hosted Agendex site that serves the `/auth/cli` sign-in handshake. */
export function getSiteUrl(isDev: boolean): string {
  return process.env.AGENDEX_SITE_URL ?? (isDev ? DEV_SITE_URL : PROD_SITE_URL);
}

function credsPath(): string {
  return join(app.getPath('userData'), 'agendex-cloud.json');
}

/**
 * Validates a Convex *site* URL against the expected `https://<id>.convex.site`
 * shape and returns its canonical origin, or `null` if it is not a trusted
 * Convex host. This is the allowlist that stops a tampered creds file (or a
 * malicious loopback callback) from pointing token-bearing refresh requests at
 * an attacker-controlled domain.
 */
function normalizeConvexSiteUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!/^[a-z0-9-]+\.convex\.site$/i.test(url.hostname)) return null;
  return url.origin;
}

let cache: CloudCreds | null | undefined;

export function loadCloudCreds(): CloudCreds | null {
  if (cache !== undefined) return cache;
  try {
    const path = credsPath();
    if (!existsSync(path)) {
      cache = null;
      return cache;
    }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      token?: string;
      enc?: boolean;
      convexSiteUrl?: string;
    };

    // Fail closed: only ever trust tokens we wrote encrypted via safeStorage.
    // A plaintext (`enc !== true`) token means the file was hand-written or
    // produced by an environment without OS encryption — ignore it rather than
    // use a credential that was sitting on disk in cleartext.
    if (!raw.token || raw.enc !== true) {
      cache = null;
      return cache;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(
        '[agendex-desktop] encrypted cloud creds require safeStorage; ignoring stored session',
      );
      cache = null;
      return cache;
    }

    const convexSiteUrl = normalizeConvexSiteUrl(raw.convexSiteUrl ?? '');
    if (!convexSiteUrl) {
      console.warn(
        '[agendex-desktop] stored cloud creds reference an untrusted Convex URL; ignoring session',
      );
      cache = null;
      return cache;
    }

    const token = safeStorage.decryptString(Buffer.from(raw.token, 'base64'));
    cache = token ? { token, convexSiteUrl } : null;
  } catch (err) {
    console.error('[agendex-desktop] failed to load cloud creds', err);
    cache = null;
  }
  return cache;
}

export function saveCloudCreds(creds: CloudCreds): void {
  // Fail closed rather than persisting a long-lived bearer token in plaintext.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS secure storage (safeStorage) is unavailable; refusing to persist cloud session in plaintext',
    );
  }
  const convexSiteUrl = normalizeConvexSiteUrl(creds.convexSiteUrl);
  if (!convexSiteUrl) {
    throw new Error(
      `Refusing to persist cloud session with an untrusted Convex URL: ${creds.convexSiteUrl}`,
    );
  }

  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const token = safeStorage.encryptString(creds.token).toString('base64');
  writeFileSync(credsPath(), JSON.stringify({ token, enc: true, convexSiteUrl }), 'utf8');
  cache = { token: creds.token, convexSiteUrl };
}

export function clearCloudCreds(): void {
  try {
    const path = credsPath();
    if (existsSync(path)) rmSync(path);
  } catch (err) {
    console.error('[agendex-desktop] failed to clear cloud creds', err);
  }
  cache = null;
}

/** Re-validates the stored cloud session and persists a rotated token when returned. */
export async function refreshCloudSession(): Promise<CloudCreds | null> {
  const creds = loadCloudCreds();
  if (!creds) return null;

  const convexUrl = creds.convexSiteUrl.replace('.convex.site', '.convex.cloud');
  try {
    const res = await fetch(`${convexUrl}/api/cli/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    if (res.status === 401) {
      clearCloudCreds();
      return null;
    }
    if (!res.ok) return creds;

    const body = (await res.json()) as { token?: string };
    if (body.token && body.token !== creds.token) {
      const refreshed = { ...creds, token: body.token };
      saveCloudCreds(refreshed);
      return refreshed;
    }
    return creds;
  } catch (err) {
    console.error('[agendex-desktop] cloud session refresh failed', err);
    return creds;
  }
}

/**
 * Runs the system-browser loopback sign-in (mirrors `agendex login`): opens the
 * hosted `/auth/cli` page pointed at a localhost callback, then resolves with the
 * session token + Convex site URL the page redirects back with.
 */
export async function runLoopbackLogin(siteUrl: string): Promise<CloudCreds> {
  const { port, result } = await startCallbackServer();
  const callbackUrl = `http://127.0.0.1:${port}/callback`;
  const authUrl = `${siteUrl}/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;
  await shell.openExternal(authUrl);
  const { token, convexUrl } = await result;
  return { token, convexSiteUrl: convexUrl };
}

interface CallbackResult {
  token: string;
  convexUrl: string;
}

async function startCallbackServer(): Promise<{ port: number; result: Promise<CallbackResult> }> {
  const server = createServer();
  const sockets = new Set<Socket>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settle: ((value: CallbackResult) => void) | undefined;
  let fail: ((reason?: unknown) => void) | undefined;

  const result = new Promise<CallbackResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const finish = (value: CallbackResult | Error) => {
    if (!settle || !fail) return;
    const resolve = settle;
    const reject = fail;
    settle = undefined;
    fail = undefined;
    if (timeout) clearTimeout(timeout);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    for (const socket of sockets) socket.destroy();
    server.unref();
    server.close();
    if (value instanceof Error) reject(value);
    else resolve(value);
  };

  server.on('request', (req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const token = requestUrl.searchParams.get('token');
    const convexParam = requestUrl.searchParams.get('convexUrl');
    // Allowlist the Convex host here, at the trust boundary, so a forged
    // callback can never seed a token paired with an attacker-controlled URL.
    const convexUrl = convexParam ? normalizeConvexSiteUrl(convexParam) : null;
    const success = Boolean(token && convexUrl);

    res.writeHead(success ? 200 : 400, {
      Connection: 'close',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(callbackPage(success));

    const value: CallbackResult | Error =
      token && convexUrl
        ? { token, convexUrl }
        : new Error('Missing or untrusted token/convexUrl in callback');

    res.once('finish', () => finish(value));
    res.once('close', () => finish(value));
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  server.once('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)));
  });

  timeout = setTimeout(() => finish(new Error('Login timed out')), LOGIN_TIMEOUT_MS);

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to determine local callback port');
  }

  return { port: address.port, result };
}

function callbackPage(success: boolean): string {
  const title = success ? 'Signed in' : 'Sign in failed';
  const message = success ? 'Return to the Agendex app.' : 'Please try signing in again.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} | Agendex</title>
  <style>
    *{box-sizing:border-box}
    :root{color-scheme:dark light;--bg:oklch(13% 0.018 180);--text:oklch(91% 0.012 125);--muted:oklch(58% 0.018 160);--accent:oklch(90% 0.23 125)}
    @media(prefers-color-scheme:light){:root{--bg:oklch(97% 0.014 125);--text:oklch(18% 0.016 135);--muted:oklch(48% 0.018 155)}}
    body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;padding:32px}
    main{width:min(100%,340px)}
    h1{font-size:21px;font-weight:560;letter-spacing:-.02em;margin:0}
    p{font-size:15px;line-height:1.5;color:var(--muted);margin:9px 0 0}
    .brand{font-family:ui-monospace,monospace;font-size:12px;color:var(--accent);margin-top:42px}
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="brand">agendex</div>
  </main>
</body>
</html>`;
}
