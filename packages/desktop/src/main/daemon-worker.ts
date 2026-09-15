import {
  clearDaemonStopRequest,
  consumeDaemonStopRequest,
  type DaemonCloudCredentials,
  requestWorkerShutdown,
  runWorker,
  setDaemonCredentialStore,
  setInjectedWorkspaceKey,
  writePid,
} from '@agendex/daemon-runtime';
import { normalizeConvexSiteUrl } from '@agendex/shared/convex-url';
import {
  parseDesktopDaemonParentMessage,
  type DesktopDaemonCredentials,
  type DesktopDaemonWorkerMessage,
} from './desktop-daemon-protocol.ts';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Agendex daemon worker requires an Electron parent port');

let credentials: DaemonCloudCredentials | null = null;
let started = false;
let authExpiredToken: string | null = null;
let credentialUpdateHandler: (() => void) | null = null;

function postMessage(message: DesktopDaemonWorkerMessage): void {
  parentPort.postMessage(message);
}

function setCredentials(next: DesktopDaemonCredentials): boolean {
  const convexUrl = normalizeConvexSiteUrl(next.convexSiteUrl);
  if (!convexUrl) return false;
  credentials = { token: next.token, convexUrl, accountId: next.accountId };
  return true;
}

setDaemonCredentialStore({
  load: () => credentials,
  saveToken: (previous, token, accountId) => {
    if (
      !credentials ||
      credentials.token !== previous.token ||
      credentials.convexUrl !== previous.convexUrl
    ) {
      return false;
    }
    credentials = { ...credentials, token, accountId };
    postMessage({ type: 'token-rotated', previousToken: previous.token, token, accountId });
    return true;
  },
  onAuthExpired: (failedToken) => {
    if (credentials?.token !== failedToken || authExpiredToken === failedToken) return;
    authExpiredToken = failedToken;
    postMessage({ type: 'auth-expired', failedToken });
  },
});

async function startWorker(
  message: Extract<ReturnType<typeof parseDesktopDaemonParentMessage>, { type: 'start' }>,
) {
  if (started || !message || !setCredentials(message.credentials)) return;
  started = true;

  clearDaemonStopRequest(process.pid);
  const stopRequestPoll = setInterval(() => {
    if (consumeDaemonStopRequest(process.pid)) void requestWorkerShutdown();
  }, 100);
  stopRequestPoll.unref();
  writePid({ launcher: 'desktop', parentPid: message.parentPid, ready: false });
  postMessage({ type: 'booted', pid: process.pid });

  const parentWatchdog = setInterval(() => {
    try {
      process.kill(message.parentPid, 0);
    } catch {
      void requestWorkerShutdown({ skipRemote: true });
    }
  }, 1_000);
  parentWatchdog.unref();

  try {
    await runWorker({
      onStatus: (status) => postMessage({ type: 'status', ...status }),
      onReady: () => {
        writePid({ launcher: 'desktop', parentPid: message.parentPid, ready: true });
        postMessage({ type: 'ready', pid: process.pid });
      },
      registerCredentialUpdateHandler: (handler) => {
        credentialUpdateHandler = handler;
      },
    });
  } catch (error) {
    postMessage({
      type: 'fatal',
      message: error instanceof Error ? error.message : 'Daemon worker failed',
    });
    process.exit(1);
  } finally {
    clearInterval(stopRequestPoll);
    clearInterval(parentWatchdog);
  }
}

parentPort.on('message', (event) => {
  const message = parseDesktopDaemonParentMessage(event.data);
  if (!message) return;

  if (message.type === 'shutdown') {
    void requestWorkerShutdown();
    return;
  }
  if (message.type === 'credentials-updated') {
    if (!setCredentials(message.credentials)) return;
    authExpiredToken = null;
    credentialUpdateHandler?.();
    return;
  }
  if (message.type === 'workspace-key-updated') {
    setInjectedWorkspaceKey(message.workspaceOwnerId, message.keyEpoch, message.keyBase64);
    return;
  }

  void startWorker(message);
});
