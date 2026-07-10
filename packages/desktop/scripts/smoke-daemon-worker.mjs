#!/usr/bin/env bun
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  connectToElectronPage,
  delay,
  evaluate,
  startManagedProcess,
  waitForExit,
} from './qa-electron-cdp.mjs';

const DEBUG_PORT = 9338;
const SITE_PORT = 3211;
const TOKEN = 'desktop-daemon-smoke-token';

function parseAppPath(argv) {
  const index = argv.indexOf('--app');
  if (index === -1 || !argv[index + 1]) {
    throw new Error('Usage: bun smoke-daemon-worker.mjs --app <packaged-electron-executable>');
  }
  return resolve(argv[index + 1]);
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitFor(check, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ''}`,
  );
}

function startCloudFixture(events) {
  const server = createServer((request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      send(401, { error: 'Unauthorized' });
      return;
    }

    if (request.url === '/api/cli/refresh' && request.method === 'POST') {
      events.refreshes += 1;
      send(200, { token: TOKEN, expiresAt: Date.now() + 60_000 });
      return;
    }
    if (request.url === '/api/cli/heartbeat' && request.method === 'POST') {
      events.heartbeats += 1;
      send(200, { ok: true });
      return;
    }
    if (request.url === '/api/cli/preferences' && request.method === 'GET') {
      send(200, { collectLocalIpAddress: false });
      return;
    }
    if (request.url === '/api/cli/sync' && request.method === 'POST') {
      send(200, { ok: true });
      return;
    }
    if (request.url?.startsWith('/api/cli/plannotator/writebacks')) {
      send(200, { writebacks: [] });
      return;
    }
    if (request.url === '/api/cli/devices' && request.method === 'DELETE') {
      events.shutdowns += 1;
      send(200, { ok: true, deleted: 1 });
      return;
    }

    send(404, { error: 'Not found' });
  });

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(SITE_PORT, '127.0.0.1', () => resolveServer(server));
  });
}

function readDesktopPid(path) {
  if (!existsSync(path)) return null;
  const info = JSON.parse(readFileSync(path, 'utf8'));
  if (
    !Number.isInteger(info.pid) ||
    info.pid <= 0 ||
    info.launcher !== 'desktop' ||
    !Number.isInteger(info.parentPid)
  ) {
    return null;
  }
  return info;
}

async function main() {
  const appPath = parseAppPath(process.argv.slice(2));
  if (!existsSync(appPath)) throw new Error(`Packaged Electron executable not found: ${appPath}`);

  const tempRoot = mkdtempSync(join(tmpdir(), 'agendex-packaged-daemon-smoke-'));
  const userDataDir = join(tempRoot, 'user-data');
  const configDir = join(tempRoot, '.agendex');
  const pidPath = join(configDir, 'daemon.pid');
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(userDataDir, 'agendex-cloud.json'),
    JSON.stringify({
      token: TOKEN,
      enc: 'qa-plaintext',
      convexSiteUrl: `http://127.0.0.1:${SITE_PORT}`,
    }),
  );

  const events = { refreshes: 0, heartbeats: 0, shutdowns: 0 };
  let server;
  let appProcess;
  let cdp;

  try {
    server = await startCloudFixture(events);
    appProcess = startManagedProcess(
      appPath,
      [`--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu'],
      {
        env: {
          AGENDEX_CONFIG_DIR: configDir,
          AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS: 'true',
          AGENDEX_DESKTOP_QA_USER_DATA_DIR: userDataDir,
          AGENDEX_DISABLE_LOCAL_IP: '1',
          AGENDEX_HTTP_TIMEOUT_MS: '2000',
          AGENDEX_PLANNOTATOR_SYNC: '0',
          HOME: tempRoot,
          USERPROFILE: tempRoot,
        },
      },
    );

    let launchError;
    appProcess.child.once('error', (error) => {
      launchError = error;
    });

    const pidInfo = await waitFor(() => {
      if (launchError) throw launchError;
      if (appProcess.child.exitCode !== null) {
        const output = appProcess.output();
        throw new Error(
          `Electron exited early (${appProcess.child.exitCode})\n${output.stdout}\n${output.stderr}`,
        );
      }
      const info = readDesktopPid(pidPath);
      return events.heartbeats > 0 && info && isProcessRunning(info.pid) ? info : null;
    }, 'a live desktop daemon heartbeat');

    if (pidInfo.parentPid !== appProcess.child.pid) {
      throw new Error(
        `Daemon parent PID ${pidInfo.parentPid} did not match Electron PID ${appProcess.child.pid}`,
      );
    }

    cdp = await connectToElectronPage(DEBUG_PORT);
    await cdp.ready;
    try {
      if (process.platform === 'win32') await evaluate(cdp, 'window.close(); true');
      else await cdp.send('Browser.close');
    } catch (error) {
      if (!String(error).includes('CDP WebSocket closed')) throw error;
    }

    const observedExit = await waitForExit(appProcess, 20_000);
    if (observedExit === null)
      throw new Error('Packaged Electron app did not exit after its window closed');
    const exitCode = appProcess.child.exitCode;
    if (exitCode !== 0 || appProcess.child.signalCode !== null) {
      throw new Error(
        `Packaged Electron app exited abnormally (code ${exitCode}, signal ${appProcess.child.signalCode})`,
      );
    }

    await waitFor(
      () => !existsSync(pidPath) && !isProcessRunning(pidInfo.pid),
      'daemon worker shutdown and PID cleanup',
      10_000,
    );
    if (events.shutdowns < 1) throw new Error('Daemon did not report its graceful shutdown');

    console.log(
      JSON.stringify({
        ok: true,
        electronExitCode: exitCode,
        daemonPid: pidInfo.pid,
        refreshes: events.refreshes,
        heartbeats: events.heartbeats,
        shutdowns: events.shutdowns,
      }),
    );
  } catch (error) {
    const output = appProcess?.output() ?? { stdout: '', stderr: '' };
    throw new Error(
      `${String(error)}\nElectron stdout:\n${output.stdout}\nElectron stderr:\n${output.stderr}`,
    );
  } finally {
    cdp?.close();
    if (appProcess && appProcess.child.exitCode === null) {
      appProcess.kill();
      await waitForExit(appProcess, 5_000);
    }
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
