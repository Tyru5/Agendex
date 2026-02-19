import { type AgendexConfig, loadConfig, saveConfig } from '@agendex/shared';

const DEFAULT_SITE_URL = 'https://agendex.dev';

export async function login(siteUrlOverride?: string): Promise<void> {
  const port = await findOpenPort();
  const callbackUrl = `http://localhost:${port}/callback`;
  const siteUrl = siteUrlOverride ?? DEFAULT_SITE_URL;

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
          return new Response(
            '<html><body><h2>Login failed</h2><p>Missing token. Please try again.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          );
        }

        clearTimeout(timeout);
        setTimeout(() => server.stop(), 500);

        resolve({ token, convexUrl });

        return new Response(
          '<html><body><h2>Login successful!</h2><p>You can close this tab and return to your terminal.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } },
        );
      },
    });
  });
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
