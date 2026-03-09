import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const packageDir = resolve(__dirname, '..');
const workspaceCli = join(packageDir, 'dist', 'cli.js');
const releaseDir = join(packageDir, '.release');

await verifyDirectRuntime();
const tarballPath = await packRelease();

try {
  await verifyPackagers(tarballPath);
} finally {
  await rm(tarballPath, { force: true });
}

async function verifyDirectRuntime() {
  const help = runSync('node', [workspaceCli, 'help']);
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Usage:/);

  const homeDir = await mkdtemp(join(tmpdir(), 'agendex-home-'));
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    AGENDEX_DISABLE_BROWSER: '1',
  };

  try {
    const status = runSync('node', [workspaceCli, 'status'], { env });
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /Config version: none/);

    const cloudState = {
      heartbeatCount: 0,
      syncBodies: [],
    };
    const server = await startFakeCloud(cloudState);

    try {
      await exerciseLogin(env, server.baseUrl);
      await createCursorFixture(homeDir);
      await exerciseSyncParse(env);
      await exerciseDaemon(env, cloudState);

      assert.ok(cloudState.heartbeatCount > 0, 'expected daemon heartbeat');
    } finally {
      await server.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function exerciseLogin(env, baseUrl) {
  const child = spawn('node', [workspaceCli, 'login', '--url', baseUrl], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let opened = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const match = stdout.match(/visit: (http:\/\/[^\s]+)/);
    if (match?.[1] && !opened) {
      opened = true;
      void fetch(match[1]).then(async (response) => {
        await response.arrayBuffer();
      });
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });

  assert.equal(exitCode, 0, stderr || stdout);

  const configPath = join(env.HOME, '.agendex', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  assert.equal(config.cloudToken, 'cloud-token');
  assert.ok(typeof config.convexUrl === 'string' && config.convexUrl.length > 0);
}

async function exerciseSyncParse(env) {
  const configPath = join(env.HOME, '.agendex', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  const originalConvexUrl = config.convexUrl;

  try {
    config.convexUrl = 'http://127.0.0.1:9';
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const sync = runSync('node', [workspaceCli, 'sync'], { env });
    assert.notEqual(sync.status, 0, 'expected sync against an unreachable host to fail');
    assert.match(sync.stdout, /Found 1 plans/);
  } finally {
    config.convexUrl = originalConvexUrl;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
}

async function exerciseDaemon(env, cloudState) {
  const start = runSync('node', [workspaceCli, 'start'], { env });
  assert.equal(start.status, 0, start.stderr || start.stdout);

  const pidPath = join(env.HOME, '.agendex', 'daemon.pid');
  await waitFor(async () => {
    try {
      const value = (await readFile(pidPath, 'utf-8')).trim();
      return /^\d+$/.test(value);
    } catch {
      return false;
    }
  }, 10_000);

  await waitFor(() => cloudState.heartbeatCount > 0, 10_000);

  const stop = runSync('node', [workspaceCli, 'stop'], { env });
  assert.equal(stop.status, 0, stop.stderr || stop.stdout);

  await waitFor(async () => {
    try {
      await readFile(pidPath, 'utf-8');
      return false;
    } catch {
      return true;
    }
  }, 10_000);
}

async function createCursorFixture(homeDir) {
  const dbDir = join(homeDir, '.cursor', 'ai-tracking');
  await mkdir(dbDir, { recursive: true });

  const dbPath = join(dbDir, 'ai-code-tracking.db');
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE prompts (id INTEGER PRIMARY KEY, prompt TEXT, model TEXT)');
    db.prepare('INSERT INTO prompts (prompt, model) VALUES (?, ?)').run(
      'Ship the npm release pipeline',
      'gpt-5',
    );
  } finally {
    db.close();
  }
}

async function startFakeCloud(state) {
  let baseUrl = '';
  const sockets = new Set();
  const respond = (res, statusCode, body, contentType) => {
    res.shouldKeepAlive = false;
    res.writeHead(statusCode, {
      Connection: 'close',
      'Content-Type': contentType,
    });
    res.end(body);
    res.once('finish', () => {
      res.socket?.destroy();
    });
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/auth/cli') {
      const callback = url.searchParams.get('callback');
      assert.ok(callback, 'missing callback parameter');
      const callbackUrl = new URL(callback);
      callbackUrl.searchParams.set('token', 'cloud-token');
      callbackUrl.searchParams.set('convexUrl', baseUrl);
      void fetch(callbackUrl).then(async (response) => {
        await response.arrayBuffer();
      });
      respond(res, 200, 'ok', 'text/plain; charset=utf-8');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cli/sync') {
      state.syncBodies.push(await readJson(req));
      respond(res, 200, '{"ok":true}', 'application/json');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cli/heartbeat') {
      state.heartbeatCount += 1;
      respond(res, 200, '{"ok":true}', 'application/json');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cli/refresh') {
      respond(res, 200, '{"token":"cloud-token","expiresAt":0}', 'application/json');
      return;
    }

    respond(res, 404, 'not found', 'text/plain; charset=utf-8');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: async () => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      for (const socket of sockets) {
        socket.destroy();
      }
      server.unref();
      server.close();
    },
  };
}

async function packRelease() {
  const pack = runSync('npm', ['pack', '--json', releaseDir], { cwd: repoRoot });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  const [{ filename }] = JSON.parse(pack.stdout);
  assert.ok(filename, 'npm pack did not produce a filename');
  return join(repoRoot, filename);
}

async function verifyPackagers(tarballPath) {
  await verifyInstalledTarball('npm', tarballPath, (cwd) => [
    'install',
    '--prefix',
    cwd,
    tarballPath,
  ]);
  await verifyInstalledTarball(
    'pnpm',
    tarballPath,
    (cwd) => ['-y', 'pnpm@latest', 'add', '--dir', cwd, tarballPath],
    { command: 'npx' },
  );
  await verifyInstalledTarball('bun', tarballPath, () => ['add', tarballPath], {
    command: 'bun',
    useWorkingDir: true,
  });
}

async function verifyInstalledTarball(name, _tarballPath, getArgs, options = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), `agendex-${name}-`));

  try {
    await writeFile(
      join(projectDir, 'package.json'),
      `${JSON.stringify({ name: `agendex-${name}-smoke`, private: true }, null, 2)}\n`,
    );

    const command = options.command ?? name;
    const install = runSync(command, getArgs(projectDir), {
      cwd: options.useWorkingDir ? projectDir : repoRoot,
    });
    assert.equal(install.status, 0, `${name} install failed\n${install.stderr || install.stdout}`);

    const binary = join(projectDir, 'node_modules', '.bin', 'agendex');
    const smoke = runSync(binary, ['help'], { cwd: projectDir });
    assert.equal(smoke.status, 0, `${name} binary failed\n${smoke.stderr || smoke.stdout}`);
    assert.match(smoke.stdout, /Usage:/);

    const status = runSync(binary, ['status'], {
      cwd: projectDir,
      env: { ...process.env, HOME: projectDir, USERPROFILE: projectDir },
    });
    assert.equal(status.status, 0, `${name} status failed\n${status.stderr || status.stdout}`);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
}

async function waitFor(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
