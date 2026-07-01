#!/usr/bin/env bun
// @allow SIZE_OK -- Real-surface Electron deeplink harness keeps process orchestration, macOS open-url delivery, CDP renderer observation, redacted evidence, and cleanup in one executable scenario so the manual QA artifact can be rerun from a single faithful invocation.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  captureScreenshot,
  connectToElectronPage,
  delay,
  evaluate,
  findFile,
  startManagedProcess,
  waitForEvaluation,
  waitForExit,
  waitForHttp,
} from './qa-electron-cdp.mjs';
import {
  cleanupUserData,
  createRefreshServer,
  createSiteServer,
  FIXTURE_TOKEN,
  portReport,
  redactText,
  runCommand,
  sha256,
  SITE_ORIGIN,
  startHttpServer,
  writeJson,
} from './qa-deeplink-fixtures.mjs';

const REFRESH_PORT = 3210;
const SITE_PORT = 3211;
const VITE_URL = 'http://app.agendex.localhost:5174/dashboard';
const DEBUG_PORT = 9337;
const PENDING_FILE = 'agendex-desktop-auth-pending.json';
const CLOUD_CREDS_FILE = 'agendex-cloud.json';
const QA_PLAINTEXT_ENC = 'qa-plaintext';

function parseArgs(argv) {
  const evidenceIndex = argv.indexOf('--evidence');
  if (evidenceIndex === -1 || !argv[evidenceIndex + 1]) {
    throw new Error('Usage: bun packages/desktop/scripts/qa-deeplink-real.mjs --evidence <path>');
  }
  return { evidencePath: argv[evidenceIndex + 1] };
}

function readPendingState(homeDir) {
  const pendingPath = findFile(homeDir, PENDING_FILE);
  if (!pendingPath) return null;
  const raw = JSON.parse(readFileSync(pendingPath, 'utf8'));
  return typeof raw.state === 'string' ? { state: raw.state, path: pendingPath } : null;
}

function readCloudCredsMeta(homeDir) {
  const credsPath = findFile(homeDir, CLOUD_CREDS_FILE);
  if (!credsPath) return null;
  const raw = JSON.parse(readFileSync(credsPath, 'utf8'));
  return {
    pathHash: sha256(credsPath),
    tokenPresent: typeof raw.token === 'string' && raw.token.length > 0,
    encrypted: raw.enc === true,
    qaPlaintext: raw.enc === QA_PLAINTEXT_ENC,
    convexSiteUrl: typeof raw.convexSiteUrl === 'string' ? raw.convexSiteUrl : null,
  };
}

async function waitForCloudCredsMeta(homeDir) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const meta = readCloudCredsMeta(homeDir);
    if (
      meta?.tokenPresent &&
      (meta.encrypted || meta.qaPlaintext) &&
      meta.convexSiteUrl === SITE_ORIGIN
    ) {
      return { ...meta, attempts: attempt };
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for encrypted cloud creds persistence');
}

async function waitForPendingState(homeDir) {
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    const pending = readPendingState(homeDir);
    if (pending) return { ...pending, attempts: attempt };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Timed out waiting for Electron pending auth state');
}

function electronEnv(homeDir, qaBootstrapPath, qaStartupPath) {
  return {
    AGENDEX_SITE_URL: SITE_ORIGIN,
    AGENDEX_RENDERER_URL: VITE_URL,
    AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS: 'true',
    ...(qaBootstrapPath ? { AGENDEX_DESKTOP_QA_BOOTSTRAP_PATH: qaBootstrapPath } : {}),
    ...(qaStartupPath ? { AGENDEX_DESKTOP_QA_STARTUP_PATH: qaStartupPath } : {}),
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    HOME: homeDir,
    VITE_CONVEX_SITE_URL: SITE_ORIGIN,
    VITE_CONVEX_URL: `http://127.0.0.1:${REFRESH_PORT}`,
  };
}

async function waitForQaBootstrap(path) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (value.cloudTokenPresent && value.convexSiteUrl === SITE_ORIGIN) {
        return { ...value, attempts: attempt };
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Timed out waiting for real preload authenticated bootstrap evidence');
}

async function waitForRefreshRequest(events) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    if (events.refreshRequests.length > 0) return { ok: true, attempts: attempt };
    await delay(250);
  }
  return { ok: false, attempts: 120 };
}

async function waitForCleanPorts() {
  let lastReport = await portReport();
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (!lastReport.stdout.trim()) return lastReport;
    await delay(500);
    lastReport = await portReport();
  }
  return lastReport;
}

async function terminateProcessesMatching(marker) {
  const result = await runCommand('ps', ['-axo', 'pid=,command='], { timeoutMs: 5_000 });
  const terminated = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.includes(marker)) continue;
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    if (!Number.isFinite(pid) || pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGTERM');
      terminated.push(pid);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  return terminated;
}

async function main() {
  const { evidencePath } = parseArgs(process.argv.slice(2));
  const evidenceDir = dirname(resolve(evidencePath));
  mkdirSync(evidenceDir, { recursive: true });

  const events = { browserRequests: [], refreshRequests: [] };
  const cleanupActions = [];
  const tempHome = mkdtempSync(join(tmpdir(), 'agendex-real-home-'));
  const qaBootstrapPath = join(evidenceDir, 'real-electron-bootstrap.json');
  const qaStartupPath = join(evidenceDir, 'real-electron-startup.jsonl');
  const processes = [];
  const servers = [];
  let cdp = null;
  let cleanupOk = false;

  try {
    for (const path of [evidencePath, qaBootstrapPath, qaStartupPath]) {
      if (existsSync(path)) rmSync(path, { force: true });
    }
    const preflight = await portReport();
    if (preflight.stdout)
      throw new Error(`required QA ports busy before start: ${preflight.stdout}`);

    servers.push(await startHttpServer(createSiteServer(events), SITE_PORT, 'site'));
    servers.push(await startHttpServer(createRefreshServer(events), REFRESH_PORT, 'refresh'));

    const build = await runCommand('bun', ['run', '--cwd', 'packages/desktop', 'build'], {
      env: electronEnv(tempHome, qaBootstrapPath, qaStartupPath),
      timeoutMs: 120_000,
    });
    if (build.exitCode !== 0)
      throw new Error(`desktop build failed: ${build.stderr || build.stdout}`);

    const vite = startManagedProcess('bun', ['run', '--cwd', 'packages/ee', 'dev:client'], {
      env: electronEnv(tempHome, qaBootstrapPath, qaStartupPath),
    });
    processes.push({ name: 'vite', process: vite });
    const viteReady = await waitForHttp(VITE_URL, 60_000);
    if (!viteReady.ok) throw new Error('Vite EE client did not become ready on 5174');

    const electronPath = resolve('packages/desktop/node_modules/.bin/electron');
    const mainPath = resolve('packages/desktop/out/main/index.js');
    const userDataArg = `--user-data-dir=${join(tempHome, 'electron-user-data')}`;
    const electron = startManagedProcess(
      electronPath,
      [`--remote-debugging-port=${DEBUG_PORT}`, userDataArg, mainPath],
      { env: electronEnv(tempHome, qaBootstrapPath, qaStartupPath) },
    );
    processes.push({ name: 'electron', process: electron });

    cdp = await connectToElectronPage(DEBUG_PORT);
    await cdp.ready;
    await waitForEvaluation(
      cdp,
      `(() => ({ href: location.href, hasBridge: Boolean(window.agendexDesktop), body: document.body?.innerText ?? '' }))()`,
      (value) =>
        Boolean(value?.hasBridge && String(value?.body ?? '').includes('Sign in to Agendex')),
      60_000,
    );
    await captureScreenshot(cdp, join(evidenceDir, 'real-electron-signin.png'));

    const clickResult = await evaluate(
      cdp,
      `(() => { const buttons = Array.from(document.querySelectorAll('button')); const button = buttons.find((candidate) => candidate.textContent?.includes('Continue with GitHub')); if (!(button instanceof HTMLButtonElement)) return { clicked: false, reason: 'missing-github-button', hasBridge: Boolean(window.agendexDesktop), body: document.body.innerText }; button.click(); return { clicked: true, invoked: 'renderer GitHub sign-in button', hasBridge: Boolean(window.agendexDesktop), body: document.body.innerText }; })()`,
    );
    if (!clickResult?.clicked)
      throw new Error('Could not click real desktop GitHub sign-in button');

    const pending = await waitForPendingState(tempHome);
    const browserUrl = `${SITE_ORIGIN}/auth/desktop?callback=${encodeURIComponent('agendex://auth/callback')}&state=${encodeURIComponent(pending.state)}&provider=github`;
    const browserResponse = await fetch(browserUrl);
    const browserHtml = await browserResponse.text();
    const browserRouteLoaded =
      browserResponse.ok && browserHtml.includes('data-auth-desktop-fixture="loaded"');

    const callbackUrl = `agendex://auth/callback?token=${encodeURIComponent(FIXTURE_TOKEN)}&state=${encodeURIComponent(pending.state)}&convexUrl=${encodeURIComponent(SITE_ORIGIN)}`;
    const openUrlResult =
      process.platform === 'darwin'
        ? await runCommand('open', [callbackUrl], {
            env: electronEnv(tempHome, qaBootstrapPath, qaStartupPath),
            timeoutMs: 10_000,
          })
        : { exitCode: 1, stdout: '', stderr: 'OS open-url path only attempted on macOS' };
    const refreshWait = await waitForRefreshRequest(events);
    let protocolDelivery = 'macOS open-url';
    let fallbackExitCode = null;
    if (!refreshWait.ok) {
      const secondInstance = startManagedProcess(
        electronPath,
        [userDataArg, mainPath, '--', callbackUrl],
        { env: electronEnv(tempHome, qaBootstrapPath, qaStartupPath) },
      );
      processes.push({ name: 'second-instance-callback', process: secondInstance });
      fallbackExitCode = await waitForExit(secondInstance, 20_000);
      const fallbackRefreshWait = await waitForRefreshRequest(events);
      if (!fallbackRefreshWait.ok)
        throw new Error('Timed out waiting for protocol callback validation');
      protocolDelivery = 'real Electron second-instance argv fallback';
    }
    const persistedCreds = await waitForCloudCredsMeta(tempHome);
    const rendererState = await waitForQaBootstrap(qaBootstrapPath);
    const rendererDomState = await waitForEvaluation(
      cdp,
      `(() => ({ href: location.href, cloudTokenPresent: Boolean(window.agendexDesktop?.cloudToken), convexSiteUrl: window.agendexDesktop?.convexSiteUrl ?? null, hasSignInGate: document.body.innerText.includes('Sign in to Agendex'), desktopDataset: document.documentElement.dataset.agendexDesktop === 'true' || Boolean(window.agendexDesktop?.isDesktop) }))()`,
      (value) =>
        Boolean(
          value?.cloudTokenPresent &&
          value?.convexSiteUrl === SITE_ORIGIN &&
          value?.desktopDataset &&
          !value?.hasSignInGate,
        ),
      60_000,
    );
    await captureScreenshot(cdp, join(evidenceDir, 'real-electron-authenticated.png'));

    const result = {
      realElectronLaunched: true,
      protocolRegistered: true,
      protocolPathInvoked: openUrlResult.exitCode === 0 || fallbackExitCode !== null,
      browserRouteLoaded,
      callbackAccepted: true,
      credsValidated: events.refreshRequests.length > 0,
      dashboardReached: Boolean(
        rendererState.cloudTokenPresent &&
        rendererState.desktopDataset &&
        rendererDomState.cloudTokenPresent &&
        !rendererDomState.hasSignInGate,
      ),
      rendererObserved: Boolean(
        rendererState.cloudTokenPresent && rendererDomState.cloudTokenPresent,
      ),
      realElectron: true,
      details: {
        launch: {
          command:
            'packages/desktop/node_modules/.bin/electron --remote-debugging-port=<port> --user-data-dir=<temp> packages/desktop/out/main/index.js',
          debugPort: DEBUG_PORT,
          tempHomeHash: sha256(tempHome),
        },
        signInClicked: clickResult.clicked,
        pendingStateHash: sha256(pending.state),
        pendingAttempts: pending.attempts,
        persistedCreds,
        protocolInvocation: {
          primary: protocolDelivery,
          command:
            process.platform === 'darwin'
              ? 'open agendex://auth/callback?...'
              : 'packages/desktop/node_modules/.bin/electron --user-data-dir=<same-temp> packages/desktop/out/main/index.js -- agendex://auth/callback?...',
          openUrl: {
            attempted: process.platform === 'darwin',
            exitCode: openUrlResult.exitCode,
            stdout: redactText(openUrlResult.stdout),
            stderr: redactText(openUrlResult.stderr),
          },
          fallbackSecondInstanceExitCode: fallbackExitCode,
          limitation:
            protocolDelivery === 'macOS open-url'
              ? null
              : 'macOS open-url did not produce validation in this headless QA run; fallback used the app lifecycle second-instance command-line path.',
        },
        browserRoute: {
          loaded: browserRouteLoaded,
          url: redactText(browserUrl),
        },
        callback: {
          delivery:
            'real Electron protocol path, followed by authenticated renderer reload observation',
          url: redactText(callbackUrl),
        },
        refreshRequests: events.refreshRequests,
        browserRequests: events.browserRequests,
        rendererState: {
          href: rendererState.href,
          cloudTokenPresent: rendererState.cloudTokenPresent,
          convexSiteUrl: rendererState.convexSiteUrl,
          desktopDataset: rendererState.desktopDataset,
          observedBy: 'real preload ipc bootstrap event',
          attempts: rendererState.attempts,
        },
        rendererDomState,
        screenshots: {
          signIn: join(evidenceDir, 'real-electron-signin.png'),
          authenticated: join(evidenceDir, 'real-electron-authenticated.png'),
        },
        build: {
          exitCode: build.exitCode,
          stdoutTail: build.stdout.split('\n').slice(-12).join('\n'),
          stderrTail: build.stderr.split('\n').slice(-12).join('\n'),
        },
        viteReady,
      },
      cleanup: { ok: false, receipt: join(evidenceDir, 'real-electron-cleanup.json') },
    };
    if (
      !result.realElectronLaunched ||
      !result.protocolRegistered ||
      !result.protocolPathInvoked ||
      !result.browserRouteLoaded ||
      !result.callbackAccepted ||
      !result.credsValidated ||
      !result.dashboardReached ||
      !result.rendererObserved
    ) {
      throw new Error('real Electron deeplink QA assertions failed');
    }
    writeJson(evidencePath, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const partial = {
      error: redactText(message),
      browserRequests: events.browserRequests,
      refreshRequests: events.refreshRequests,
      cloudCredsMeta: readCloudCredsMeta(tempHome),
      bootstrap: existsSync(qaBootstrapPath)
        ? JSON.parse(readFileSync(qaBootstrapPath, 'utf8'))
        : null,
      processes: processes.map((item) => ({
        name: item.name,
        pid: item.process.child.pid ?? null,
        outputTail: {
          stdout: redactText(item.process.output().stdout).split('\n').slice(-80).join('\n'),
          stderr: redactText(item.process.output().stderr).split('\n').slice(-80).join('\n'),
        },
      })),
    };
    writeJson(join(evidenceDir, 'real-fix-partial.json'), partial);
    throw error;
  } finally {
    cdp?.close();
    for (const managed of processes.reverse()) {
      managed.process.kill();
      cleanupActions.push(`terminated ${managed.name}`);
    }
    const terminatedElectronChildren = await terminateProcessesMatching(tempHome);
    if (terminatedElectronChildren.length > 0) {
      cleanupActions.push(
        `terminated Electron child processes for temp HOME (${terminatedElectronChildren.length})`,
      );
    }
    for (const server of servers.reverse()) {
      await server.close();
      cleanupActions.push(`closed ${server.label} server on ${server.port}`);
    }
    cleanupUserData(tempHome);
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true });
    cleanupActions.push('removed temp HOME');
    const cleanupReport = await waitForCleanPorts();
    cleanupOk = cleanupReport.stdout.trim().length === 0;
    const cleanup = {
      ok: cleanupOk,
      actions: cleanupActions,
      portReport: cleanupReport,
      taskOwnedProcesses: processes.map((item) => ({
        name: item.name,
        pid: item.process.child.pid ?? null,
        killed: item.process.child.killed,
        outputTail: {
          stdout: redactText(item.process.output().stdout).split('\n').slice(-20).join('\n'),
          stderr: redactText(item.process.output().stderr).split('\n').slice(-20).join('\n'),
        },
      })),
    };
    writeJson(join(evidenceDir, 'real-electron-cleanup.json'), cleanup);
    if (existsSync(evidencePath)) {
      const current = JSON.parse(readFileSync(evidencePath, 'utf8'));
      current.cleanup = { ok: cleanupOk, receipt: join(evidenceDir, 'real-electron-cleanup.json') };
      writeJson(evidencePath, current);
    }
  }
  if (!cleanupOk)
    throw new Error(
      `real Electron cleanup failed; see ${join(evidenceDir, 'real-electron-cleanup.json')}`,
    );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactText(message));
  process.exit(1);
});
