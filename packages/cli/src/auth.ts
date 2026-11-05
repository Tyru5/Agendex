import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { CURRENT_CONFIG_VERSION, isDevMode, loadConfig, updateConfig } from '@agendex/shared';
import { normalizeConvexSiteUrl } from '@agendex/shared/convex-url';
import { validateDesktopAuthCallbackState } from '@agendex/shared/desktop-auth-callback';
import { refreshToken } from './api.ts';

const PROD_SITE_URL = 'https://app.agendex.dev';
const DEV_SITE_URL = 'http://app.agendex.localhost:5174';

export function getDefaultSiteUrl(): string {
  if (process.env.AGENDEX_SITE_URL) return process.env.AGENDEX_SITE_URL;

  return isDevMode() ? DEV_SITE_URL : PROD_SITE_URL;
}

/** Resolved web app URL: login-stored config, then env/default (same precedence as login sans override). */
export function getSiteUrl(): string {
  const config = loadConfig();
  if (config?.siteUrl) return config.siteUrl;

  return getDefaultSiteUrl();
}

/**
 * Prints the standard opening messages and opens the URL in the system browser,
 * unless AGENDEX_DISABLE_BROWSER=1.
 */
export function launchBrowser(url: string, label: string): void {
  console.log(`[agendex] Opening ${label}...`);
  console.log(`[agendex] If it doesn't open, visit: ${url}`);

  if (process.env.AGENDEX_DISABLE_BROWSER === '1') {
    console.log('[agendex] Browser launch disabled by AGENDEX_DISABLE_BROWSER=1.');
  } else {
    openBrowser(url);
  }
}

export async function login(siteUrlOverride?: string): Promise<void> {
  // The nonce rides inside the callback URL: the web /auth/cli page keeps the
  // callback's existing query params and only adds token/convexUrl, so a local
  // request that doesn't echo it back can't complete (or forge) this login.
  const state = randomBytes(32).toString('base64url');
  const existing = loadConfig();
  const siteUrl = siteUrlOverride ?? existing?.siteUrl ?? getDefaultSiteUrl();
  const { port, result } = await startCallbackServer({ state, siteUrl });
  const callbackUrl = `http://127.0.0.1:${port}/callback?state=${encodeURIComponent(state)}`;

  const authUrl = `${siteUrl}/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;

  launchBrowser(authUrl, 'browser for authentication');

  const callback = await result;
  const session = await refreshToken(callback.token, callback.convexUrl);
  if (!session) throw new Error('Cloud session validation failed. Run `agendex login` again.');

  updateConfig((current) => ({
    ...(current ?? existing),
    configVersion: CURRENT_CONFIG_VERSION,
    cloudToken: session.token,
    cloudAccountId: session.accountId,
    convexUrl: callback.convexUrl,
    siteUrl,
    enabledAdapters: current?.enabledAdapters ?? existing?.enabledAdapters ?? [],
    customPlanDirs: current?.customPlanDirs ?? existing?.customPlanDirs ?? [],
  }));

  console.log(`[agendex] Logged in successfully!`);
  console.log(`[agendex] Cloud token saved to config.`);
}

export function logout(): void {
  const existing = loadConfig();
  if (!existing) {
    console.log('[agendex] Not logged in.');
    return;
  }

  updateConfig((current) => {
    if (!current) return null;
    const {
      cloudToken: _cloudToken,
      cloudAccountId: _cloudAccountId,
      convexUrl: _convexUrl,
      ...config
    } = current;
    return config;
  });
  console.log('[agendex] Logged out. Cloud token removed.');
}

export interface CallbackResult {
  token: string;
  convexUrl: string;
}

export interface CallbackServerOptions {
  /** Nonce the callback must echo back as `state`. */
  state: string;
  /** Web app the user chose to log in to; a Convex URL on its origin is trusted too. */
  siteUrl?: string;
  timeoutMs?: number;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Convex site URLs the CLI will persist: hosted (`https://*.convex.site`), the
 * local dev backend, or the same origin as the chosen site URL (self-hosted).
 */
function trustedConvexUrl(rawConvexUrl: string, siteUrl: string | undefined): string | null {
  const normalized = normalizeConvexSiteUrl(rawConvexUrl);
  if (normalized) return normalized;
  const origin = originOf(rawConvexUrl);
  const siteOrigin = siteUrl ? originOf(siteUrl) : null;
  return origin && origin !== 'null' && origin === siteOrigin ? origin : null;
}

/** Validates a login callback request: exact state match and a trusted Convex site URL. */
export function parseLoginCallback(
  searchParams: URLSearchParams,
  expectedState: string,
  siteUrl?: string,
): CallbackResult | Error {
  const stateResult = validateDesktopAuthCallbackState(searchParams.get('state'), {
    state: expectedState,
  });
  if (!stateResult.ok) {
    return new Error(
      stateResult.error.code === 'missing-state'
        ? 'Login callback is missing its state parameter; ignoring it. Run `agendex login` again.'
        : 'Login callback state does not match this login attempt. Run `agendex login` again.',
    );
  }

  const token = searchParams.get('token');
  const rawConvexUrl = searchParams.get('convexUrl');
  if (!token || !rawConvexUrl) return new Error('Missing token or convexUrl in callback');

  const convexUrl = trustedConvexUrl(rawConvexUrl, siteUrl);
  if (!convexUrl) {
    return new Error(
      `Login callback supplied an untrusted Convex URL (${rawConvexUrl}); expected an https://*.convex.site URL, the local http://127.0.0.1:3211 backend, or the site URL's own origin.`,
    );
  }
  return { token, convexUrl };
}

export async function startCallbackServer(
  options: CallbackServerOptions,
): Promise<{ port: number; result: Promise<CallbackResult> }> {
  const server = createServer();
  const sockets = new Set<import('node:net').Socket>();
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
    for (const socket of sockets) {
      socket.destroy();
    }
    server.unref();
    server.close();
    if (value instanceof Error) {
      reject(value);
      return;
    }
    resolve(value);
  };

  server.on('request', (req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const callbackValue = parseLoginCallback(
      requestUrl.searchParams,
      options.state,
      options.siteUrl,
    );
    const success = !(callbackValue instanceof Error);

    res.writeHead(success ? 200 : 400, {
      Connection: 'close',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(callbackPage(success));

    // A request without this attempt's state didn't come from our login page:
    // reject it but keep waiting, so a stray or forged request can't abort the login.
    const stateMatches = validateDesktopAuthCallbackState(requestUrl.searchParams.get('state'), {
      state: options.state,
    }).ok;
    if (!stateMatches) return;

    res.once('finish', () => {
      finish(callbackValue);
    });
    res.once('close', () => {
      finish(callbackValue);
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  server.once('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)));
  });

  timeout = setTimeout(
    () => {
      finish(new Error('Login timed out after 5 minutes'));
    },
    options.timeoutMs ?? 5 * 60 * 1000,
  );

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to determine local callback port');
  }

  return {
    port: address.port,
    result,
  };
}

function callbackPage(success: boolean): string {
  const title = success ? 'Signed in' : 'Sign in failed';
  const message = success ? 'Return to your terminal.' : 'Run agendex login again.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} | Agendex</title>
  <style>
    *{box-sizing:border-box}
    :root{color-scheme:dark light;--bg:oklch(13% 0.018 180);--text:oklch(91% 0.012 125);--muted:oklch(58% 0.018 160);--accent:oklch(90% 0.23 125);--err:oklch(64% 0.2 25)}
    @media(prefers-color-scheme:light){:root{--bg:oklch(97% 0.014 125);--text:oklch(18% 0.016 135);--muted:oklch(48% 0.018 155)}}
    body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;padding:32px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    main{width:min(100%,340px)}
    h1{font-size:21px;font-weight:560;line-height:1.25;letter-spacing:-.02em;margin:0}
    p{font-size:15px;line-height:1.5;color:var(--muted);margin:9px 0 0}
    .brand{font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,monospace;font-size:12px;line-height:1;color:var(--accent);margin-top:42px;letter-spacing:.02em}
  </style>
</head>
<body>
  <main aria-labelledby="callback-title">
    <h1 id="callback-title">${title}</h1>
    <p>${message}</p>
    <div class="brand">agendex</div>
  </main>
</body>
</html>`;
}

export function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    spawnBrowser('open', [url]);
    return;
  }

  if (process.platform === 'win32') {
    spawnBrowser('cmd', ['/c', 'start', '', url], {
      windowsHide: true,
    });
    return;
  }

  spawnBrowser('xdg-open', [url]);
}

function spawnBrowser(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2] = {},
): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    ...options,
  });

  // The URL is already printed above, so opener failures should not crash login.
  child.on('error', () => {});
  child.unref();
}
