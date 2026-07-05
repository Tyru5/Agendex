import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

export const SITE_ORIGIN = 'http://127.0.0.1:3211';
export const REFRESH_ORIGIN = 'http://127.0.0.1:3210';
export const FIXTURE_TOKEN = 'qa-fixture-token';
export const FIXTURE_ROTATED_TOKEN = 'qa-fixture-token-rotated';
export const REDACTED = '<redacted>';

const DEFAULT_TIMEOUT_MS = 60_000;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function redactText(value) {
  return value
    .replaceAll(FIXTURE_TOKEN, REDACTED)
    .replaceAll(FIXTURE_ROTATED_TOKEN, REDACTED)
    .replace(/generated auth token:\s*[a-f0-9]{64}/gi, `generated auth token: ${REDACTED}`)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, `Bearer ${REDACTED}`)
    .replace(/([?&](?:token|state|convexUrl|callback)=)([^&#\s]*)/gi, `$1${REDACTED}`);
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function withTimeout(work, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeout = new Promise((_, reject) => {
    const handle = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    handle.unref?.();
  });
  return Promise.race([work, timeout]);
}

export async function startHttpServer(server, port, label) {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  return {
    label,
    port,
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
      }),
  };
}

export async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await withTimeout(
    new Promise((resolveExit) => {
      child.on('exit', (code) => resolveExit(code ?? 1));
    }),
    `${command} ${args.join(' ')}`,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ).catch((error) => {
    child.kill('SIGTERM');
    throw error;
  });
  return { exitCode, stdout: redactText(stdout), stderr: redactText(stderr) };
}

export async function portReport() {
  const result = await runCommand(
    'lsof',
    ['-nP', '-iTCP:3210', '-iTCP:3211', '-iTCP:5174', '-iTCP:9337', '-sTCP:LISTEN'],
    {
      timeoutMs: 5_000,
    },
  ).catch((error) => ({
    exitCode: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  }));
  return {
    command: 'lsof -nP -iTCP:3210 -iTCP:3211 -iTCP:5174 -iTCP:9337 -sTCP:LISTEN',
    exitCode: result.exitCode,
    stdout: redactText(result.stdout.trim()),
    stderr: redactText(result.stderr.trim()),
  };
}

export async function waitForServer(url) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return { ok: true, attempts: attempt };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await delay(100);
  }
  return { ok: false, attempts: 30 };
}

export function createSiteServer(events) {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', SITE_ORIGIN);
    if (requestUrl.pathname !== '/auth/desktop') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }

    const callback = requestUrl.searchParams.get('callback');
    const state = requestUrl.searchParams.get('state');
    const provider = requestUrl.searchParams.get('provider');
    const callbackUrl =
      callback && state
        ? `${callback}?state=${encodeURIComponent(state)}&provider=${encodeURIComponent(provider ?? 'github')}&token=${encodeURIComponent(FIXTURE_TOKEN)}&convexUrl=${encodeURIComponent(SITE_ORIGIN)}`
        : '';

    events.browserRequests.push({
      pathname: requestUrl.pathname,
      provider: provider ?? null,
      callbackTarget: callback ?? null,
      stateHash: state ? sha256(state) : null,
    });

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
<html><head><title>Agendex desktop auth fixture</title></head>
<body>
  <main data-auth-desktop-fixture="loaded" data-provider="${provider ?? ''}">
    <a id="callback" href="${callbackUrl.replaceAll('"', '&quot;')}">Return to Agendex</a>
  </main>
</body></html>`);
  });
}

export function createRefreshServer(events) {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', REFRESH_ORIGIN);
    if (request.method !== 'POST' || requestUrl.pathname !== '/api/cli/refresh') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const authHeader = request.headers.authorization ?? '';
    events.refreshRequests.push({
      path: requestUrl.pathname,
      method: request.method,
      authorizationHash: sha256(authHeader),
      authorizationRedacted: authHeader ? `Bearer ${REDACTED}` : '',
    });

    if (
      authHeader !== `Bearer ${FIXTURE_TOKEN}` &&
      authHeader !== `Bearer ${FIXTURE_ROTATED_TOKEN}`
    ) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ token: FIXTURE_ROTATED_TOKEN }));
  });
}

export function cleanupUserData(path) {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}
