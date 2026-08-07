import { startNodeServer, type RunningNodeServer } from '@agendex/app/server';
import {
  parseDesktopBackendParentMessage,
  type DesktopBackendWorkerMessage,
} from './desktop-backend-protocol.ts';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Agendex backend worker requires an Electron parent port');

let server: RunningNodeServer | null = null;
let clientDistDir = '';
let started = false;
let stopping = false;

function postMessage(message: DesktopBackendWorkerMessage): void {
  parentPort.postMessage(message);
}

async function shutdown(exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await server?.close();
  } finally {
    process.exit(exitCode);
  }
}

parentPort.on('message', (event) => {
  const message = parseDesktopBackendParentMessage(event.data);
  if (!message) return;
  if (message.type === 'shutdown') {
    void shutdown();
    return;
  }
  if (message.type === 'set-client-dist-dir') {
    clientDistDir = message.clientDistDir;
    return;
  }
  if (started) return;
  started = true;
  clientDistDir = message.clientDistDir;

  const parentWatchdog = setInterval(() => {
    try {
      process.kill(message.parentPid, 0);
    } catch {
      void shutdown();
    }
  }, 1_000);
  parentWatchdog.unref();

  void startNodeServer({
    port: message.port,
    hostname: message.hostname,
    clientDistDir: () => clientDistDir,
  })
    .then((running) => {
      server = running;
      postMessage({ type: 'listening', port: running.port, token: running.token });
      void running.ready.then(
        () => postMessage({ type: 'index-ready' }),
        (error) => {
          postMessage({
            type: 'fatal',
            phase: 'indexing',
            message: error instanceof Error ? error.message : 'Local plan indexing failed',
          });
          // Readiness rejection is terminal because every API route awaits it.
          void shutdown(1);
        },
      );
    })
    .catch((error) => {
      postMessage({
        type: 'fatal',
        phase: 'startup',
        message: error instanceof Error ? error.message : 'Local API failed to start',
      });
      process.exit(1);
    });
});
