import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { type AgendexConfig, isDevMode, loadConfig, saveConfig } from '@agendex/shared';

const PROD_SITE_URL = 'https://app.agendex.dev';
const DEV_SITE_URL = 'http://app.agendex.local:5174';

export function getDefaultSiteUrl(): string {
  if (process.env.AGENDEX_SITE_URL) return process.env.AGENDEX_SITE_URL;

  return isDevMode() ? DEV_SITE_URL : PROD_SITE_URL;
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
  const { port, result } = await startCallbackServer();
  const callbackUrl = `http://127.0.0.1:${port}/callback`;
  const siteUrl = siteUrlOverride ?? getDefaultSiteUrl();

  const authUrl = `${siteUrl}/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;

  launchBrowser(authUrl, 'browser for authentication');

  const callback = await result;

  const existing = loadConfig();
  const config: AgendexConfig = {
    configVersion: 3,
    token: existing?.token,
    cloudToken: callback.token,
    convexUrl: callback.convexUrl,
    enabledAdapters: existing?.enabledAdapters ?? [],
    customPlanDirs: existing?.customPlanDirs ?? [],
  };
  saveConfig(config);

  console.log(`[agendex] Logged in successfully!`);
  console.log(`[agendex] Cloud token saved to config.`);
}

export function logout(): void {
  const existing = loadConfig();
  if (!existing) {
    console.log('[agendex] Not logged in.');
    return;
  }

  const config: AgendexConfig = {
    configVersion: 3,
    token: existing.token,
    cloudToken: undefined,
    convexUrl: undefined,
    enabledAdapters: existing.enabledAdapters,
    customPlanDirs: existing.customPlanDirs,
  };
  saveConfig(config);
  console.log('[agendex] Logged out. Cloud token removed.');
}

interface CallbackResult {
  token: string;
  convexUrl: string;
}

async function startCallbackServer(): Promise<{ port: number; result: Promise<CallbackResult> }> {
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

    const token = requestUrl.searchParams.get('token');
    const convexUrl = requestUrl.searchParams.get('convexUrl');
    const success = Boolean(token && convexUrl);

    res.writeHead(success ? 200 : 400, {
      Connection: 'close',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(callbackPage(success));
    const callbackValue = success
      ? {
          token: token ?? '',
          convexUrl: convexUrl ?? '',
        }
      : new Error('Missing token or convexUrl in callback');

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
    5 * 60 * 1000,
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
  const title = success ? 'Login successful' : 'Login failed';
  const message = success
    ? 'You can close this tab and return to your terminal.'
    : 'Missing token. Please try again.';
  const icon = success
    ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:32px;height:32px;color:#22c55e"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:32px;height:32px;color:#ef4444"><path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — Agendex</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    @media(prefers-color-scheme:dark){
      :root{--bg:#111;--surface:#161616;--text:#e8e8e8;--secondary:#888;--tertiary:#555;--border:rgba(255,255,255,0.06)}
    }
    @media(prefers-color-scheme:light){
      :root{--bg:#fafafa;--surface:#fff;--text:#111;--secondary:#666;--tertiary:#999;--border:rgba(0,0,0,0.06)}
    }
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh;-webkit-font-smoothing:antialiased}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px 48px;text-align:center;max-width:400px;width:100%;box-shadow:0 2px 16px rgba(0,0,0,0.04)}
    .icon{margin-bottom:16px;display:flex;justify-content:center}
    h1{font-size:18px;font-weight:600;letter-spacing:-0.02em;margin-bottom:8px}
    p{font-size:13px;color:var(--secondary);line-height:1.5}
    .brand{margin-top:24px;font-size:11px;color:var(--tertiary);letter-spacing:0.04em;font-weight:500}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="brand">AGENDEX</div>
  </div>
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
