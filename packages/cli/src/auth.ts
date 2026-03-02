import { type AgendexConfig, loadConfig, saveConfig } from '@agendex/shared';

// const LOCAL_TESTING = 'http://localhost:5174';
const DEFAULT_SITE_URL = 'https://agendex.dev';

export async function login(siteUrlOverride?: string): Promise<void> {
  const port = await findOpenPort();
  const callbackUrl = `http://localhost:${port}/callback`;
  const siteUrl = siteUrlOverride ?? DEFAULT_SITE_URL;

  // const siteUrl = siteUrlOverride ?? LOCAL_TESTING;

  const authUrl = `${siteUrl}/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;

  console.log(`[agendex] Opening browser for authentication...`);
  console.log(`[agendex] If it doesn't open, visit: ${authUrl}`);

  openBrowser(authUrl);

  const result = await waitForCallback(port);

  const existing = loadConfig();
  const config: AgendexConfig = {
    configVersion: 3,
    token: existing?.token,
    cloudToken: result.token,
    convexUrl: result.convexUrl,
    enabledAdapters: existing?.enabledAdapters ?? [],
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
  };
  saveConfig(config);
  console.log('[agendex] Logged out. Cloud token removed.');
}

interface CallbackResult {
  token: string;
  convexUrl: string;
}

function waitForCallback(port: number): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        server.stop();
        reject(new Error('Login timed out after 5 minutes'));
      },
      5 * 60 * 1000,
    );

    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== '/callback') {
          return new Response('Not found', { status: 404 });
        }

        const token = url.searchParams.get('token');
        const convexUrl = url.searchParams.get('convexUrl');

        if (!token || !convexUrl) {
          return new Response(callbackPage(false), {
            headers: { 'Content-Type': 'text/html' },
          });
        }

        clearTimeout(timeout);
        setTimeout(() => server.stop(), 500);

        resolve({ token, convexUrl });

        return new Response(callbackPage(true), {
          headers: { 'Content-Type': 'text/html' },
        });
      },
    });
  });
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

async function findOpenPort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = server.port ?? 0;
  server.stop();

  return port;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  Bun.spawn([cmd, url], { stdout: 'ignore', stderr: 'ignore' });
}
