#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mock } from 'bun:test';
import {
  cleanupUserData,
  createRefreshServer,
  createSiteServer,
  FIXTURE_ROTATED_TOKEN,
  FIXTURE_TOKEN,
  portReport,
  REDACTED,
  redactText,
  REFRESH_ORIGIN,
  runCommand,
  sha256,
  SITE_ORIGIN,
  startHttpServer,
  waitForServer,
  writeJson,
} from './qa-deeplink-fixtures.mjs';

function parseArgs(argv) {
  const evidenceIndex = argv.indexOf('--evidence');
  if (evidenceIndex === -1 || !argv[evidenceIndex + 1]) {
    throw new Error('Usage: bun packages/desktop/scripts/qa-deeplink.mjs --evidence <path>');
  }
  return {
    evidencePath: argv[evidenceIndex + 1],
    abortAfterStart: argv.includes('--abort-after-start'),
  };
}

function installElectronMock(userDataPath, openedUrls) {
  mock.module('electron', () => ({
    app: {
      getPath: () => userDataPath,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    shell: {
      openExternal: async (url) => {
        openedUrls.push(url);
      },
    },
  }));
}

async function main() {
  const { evidencePath, abortAfterStart } = parseArgs(process.argv.slice(2));
  const evidenceDir = dirname(resolve(evidencePath));
  mkdirSync(evidenceDir, { recursive: true });

  const events = { browserRequests: [], refreshRequests: [] };
  const openedUrls = [];
  const navigationCalls = [];
  const logs = [];
  const cleanupActions = [];
  const userDataPath = mkdtempSync(join(tmpdir(), 'agendex-qa-deeplink-'));
  let cleanupOk = false;
  let cleanupReport = null;
  const servers = [];

  try {
    installElectronMock(userDataPath, openedUrls);

    const [
      { createDesktopAuthCallbackUrl },
      { loadCloudCreds, saveCloudCreds, validateCloudCreds },
      {
        clearPendingDesktopAuthLogin,
        completePendingDesktopAuthLogin,
        loadPendingDesktopAuthLogin,
        startDesktopAuthLogin,
      },
      { createDesktopProtocolController, registerDesktopProtocolClient },
    ] = await Promise.all([
      import('@agendex/shared/desktop-auth-callback'),
      import('../src/main/cloud-auth.ts'),
      import('../src/main/cloud-login.ts'),
      import('../src/main/desktop-protocol.ts'),
    ]);

    const preflight = await portReport();
    if (preflight.stdout) {
      throw new Error(`required QA ports are busy before harness start: ${preflight.stdout}`);
    }

    const siteServer = await startHttpServer(createSiteServer(events), 3211, 'site');
    const refreshServer = await startHttpServer(createRefreshServer(events), 3210, 'refresh');
    servers.push(siteServer, refreshServer);

    if (abortAfterStart) {
      throw new Error('intentional abort after fixture servers started');
    }

    const build = await runCommand('bun', ['run', '--cwd', 'packages/desktop', 'build'], {
      env: { AGENDEX_SITE_URL: SITE_ORIGIN },
      timeoutMs: 120_000,
    });
    if (build.exitCode !== 0) {
      throw new Error(`desktop build failed: ${build.stderr || build.stdout}`);
    }

    const protocolRegistered = registerDesktopProtocolClient({
      isDefaultApp: false,
      execPath: process.execPath,
      argv: process.argv,
      setAsDefaultProtocolClient: (protocol) => protocol === 'agendex',
    });

    clearPendingDesktopAuthLogin();
    const pending = await startDesktopAuthLogin(SITE_ORIGIN, 'github', {
      nowMs: () => 10_000,
      scheduleTimeout: () => ({ unref: () => undefined }),
    });
    const openedUrl = openedUrls[0];
    if (!openedUrl) throw new Error('desktop login did not open browser URL');

    const routeWait = await waitForServer(
      `${SITE_ORIGIN}/auth/desktop?callback=agendex%3A%2F%2Fauth%2Fcallback&state=probe&provider=github`,
    );
    const browserResponse = await fetch(openedUrl);
    const browserHtml = await browserResponse.text();
    const browserRouteLoaded =
      browserResponse.ok && browserHtml.includes('data-auth-desktop-fixture="loaded"');

    const callbackUrl = createDesktopAuthCallbackUrl({
      token: FIXTURE_TOKEN,
      state: pending.state,
      convexUrl: SITE_ORIGIN,
    });
    if (!callbackUrl) throw new Error('failed to create fixture desktop callback URL');

    const controller = createDesktopProtocolController({
      loadPendingLogin: loadPendingDesktopAuthLogin,
      completePendingLogin: completePendingDesktopAuthLogin,
      validateCloudCreds,
      saveCloudCreds,
      getWindowState: () => ({ hasWindow: true, isDestroyed: false }),
      reloadDashboardWindow: () => {
        navigationCalls.push('reload-dashboard');
      },
      focusDashboardWindow: () => {
        navigationCalls.push('focus-dashboard');
      },
      createDashboardWindow: () => {
        navigationCalls.push('create-dashboard');
      },
      log: (message) => {
        logs.push(redactText(message));
      },
      nowMs: () => 10_001,
    });

    const callbackAccepted = await controller.completeProtocolCallback(callbackUrl);
    const creds = loadCloudCreds();
    const credsValidated =
      events.refreshRequests.length === 1 && creds?.token === FIXTURE_ROTATED_TOKEN;
    const dashboardReached =
      navigationCalls.includes('reload-dashboard') && navigationCalls.includes('focus-dashboard');

    const badProtocolRejected = !(await controller.completeProtocolCallback(
      'agendex://evil/callback?token=x',
    ));
    const hostileCallback = `${callbackUrl}&prompt=ignore-previous-instructions&token=${encodeURIComponent(FIXTURE_TOKEN)}`;
    const duplicateRejected = !(await controller.completeProtocolCallback(hostileCallback));
    const expiredRejected = completePendingDesktopAuthLogin(pending.state, 400_001).ok === false;

    const cleanupBeforeResult = {
      tempUserData: userDataPath,
      pendingExists: Boolean(loadPendingDesktopAuthLogin(10_002)),
    };

    const finalResult = {
      protocolRegistered,
      browserRouteLoaded,
      callbackAccepted,
      credsValidated,
      dashboardReached,
      details: {
        fixtureSite: SITE_ORIGIN,
        fixtureRefresh: REFRESH_ORIGIN,
        browserWaitAttempts: routeWait.attempts,
        openedAuthUrl: redactText(openedUrl),
        callbackUrl: redactText(callbackUrl),
        pendingStateHash: sha256(pending.state),
        savedTokenHash: creds?.token ? sha256(creds.token) : null,
        refreshRequests: events.refreshRequests,
        browserRequests: events.browserRequests,
        navigationCalls,
        logs,
        adversarialProbeSummary: {
          badProtocolRejected,
          duplicateRejected,
          expiredRejected,
        },
        build: {
          command: 'bun run --cwd packages/desktop build',
          exitCode: build.exitCode,
          stdoutTail: build.stdout.split('\n').slice(-12).join('\n'),
          stderrTail: build.stderr.split('\n').slice(-12).join('\n'),
        },
        cleanupBeforeResult,
      },
      cleanup: { ok: false, receipt: join(evidenceDir, 'cleanup.json') },
    };

    if (
      !protocolRegistered ||
      !browserRouteLoaded ||
      !callbackAccepted ||
      !credsValidated ||
      !dashboardReached ||
      !badProtocolRejected ||
      !duplicateRejected ||
      !expiredRejected
    ) {
      throw new Error('desktop auth deeplink QA assertions failed');
    }

    writeJson(evidencePath, finalResult);
  } finally {
    for (const server of servers.reverse()) {
      await server.close();
      cleanupActions.push(`closed ${server.label} server on ${server.port}`);
    }
    cleanupUserData(userDataPath);
    cleanupActions.push('removed temp userData');
    cleanupReport = await portReport();
    cleanupOk = cleanupReport.stdout.trim().length === 0;
    const receipt = {
      ok: cleanupOk,
      actions: cleanupActions,
      portReport: cleanupReport,
      tmux: 'no tmux sessions created by harness',
      pids: 'fixture servers closed in-process',
    };
    writeJson(join(evidenceDir, 'cleanup.json'), receipt);

    if (existsSync(evidencePath)) {
      const current = JSON.parse(readFileSync(evidencePath, 'utf8'));
      current.cleanup = { ok: cleanupOk, receipt: join(evidenceDir, 'cleanup.json') };
      writeJson(evidencePath, current);
    }
  }

  if (!cleanupOk) {
    throw new Error(`cleanup failed; see ${join(evidenceDir, 'cleanup.json')}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactText(message));
  process.exit(1);
});
