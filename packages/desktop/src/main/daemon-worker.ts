import {
  type DaemonCloudCredentials,
  removePid,
  requestWorkerShutdown,
  runWorker,
  setDaemonCredentialStore,
  writePid,
} from 'agendex-cli/daemon-runtime';
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
let authExpiredReported = false;

function postMessage(message: DesktopDaemonWorkerMessage): void {
  parentPort.postMessage(message);
}

function setCredentials(next: DesktopDaemonCredentials): boolean {
  const convexUrl = normalizeConvexSiteUrl(next.convexSiteUrl);
  if (!convexUrl) return false;
  credentials = { token: next.token, convexUrl };
  return true;
}

setDaemonCredentialStore({
  load: () => credentials,
  saveToken: (previousToken, token) => {
    if (!credentials || credentials.token !== previousToken) return;
    credentials = { ...credentials, token };
    postMessage({ type: 'token-rotated', previousToken, token });
  },
  onAuthExpired: () => {
    if (authExpiredReported) return;
    authExpiredReported = true;
    postMessage({ type: 'auth-expired' });
  },
});

async function startWorker(
  message: Extract<ReturnType<typeof parseDesktopDaemonParentMessage>, { type: 'start' }>,
) {
  if (started || !message || !setCredentials(message.credentials)) return;
  started = true;

  writePid({ launcher: 'desktop', parentPid: message.parentPid });
  process.once('exit', () => removePid(process.pid));

  const parentWatchdog = setInterval(() => {
    try {
      process.kill(message.parentPid, 0);
    } catch {
      void requestWorkerShutdown();
    }
  }, 1_000);
  parentWatchdog.unref();

  try {
    await runWorker({
      onReady: () => postMessage({ type: 'ready', pid: process.pid }),
    });
  } catch (error) {
    postMessage({
      type: 'fatal',
      message: error instanceof Error ? error.message : 'Daemon worker failed',
    });
    process.exit(1);
  } finally {
    clearInterval(parentWatchdog);
    removePid(process.pid);
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
    setCredentials(message.credentials);
    authExpiredReported = false;
    return;
  }

  void startWorker(message);
});
