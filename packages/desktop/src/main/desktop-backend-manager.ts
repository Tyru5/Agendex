import { join } from 'node:path';
import type { UtilityProcess } from 'electron';
import {
  parseDesktopBackendWorkerMessage,
  type DesktopBackendParentMessage,
} from './desktop-backend-protocol.ts';

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 1_500;
const DEFAULT_KILL_TIMEOUT_MS = 1_000;
const DEFAULT_RESTART_DELAY_MS = 1_000;

export type DesktopBackendState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'indexing' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export interface DesktopBackendStartOptions {
  port: number;
  hostname: string;
  clientDistDir: string;
}

export interface DesktopBackendConnection {
  port: number;
  token: string;
}

export interface DesktopBackendManagerOptions {
  forkWorker: typeof import('electron').utilityProcess.fork;
  getWorkerEnv: () => NodeJS.ProcessEnv;
  log: (message: string, error?: unknown) => void;
  onStateChange?: (state: DesktopBackendState) => void;
  onUnexpectedExit?: (error: Error) => void;
  onConnectionRestored?: (connection: DesktopBackendConnection) => void;
  workerEntry?: string;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  killTimeoutMs?: number;
  restartDelayMs?: number;
}

export class DesktopBackendManager {
  private child: UtilityProcess | null = null;
  private connection: DesktopBackendConnection | null = null;
  private startPromise: Promise<DesktopBackendConnection> | null = null;
  private stopPromise: Promise<void> | null = null;
  private pendingStart: {
    child: UtilityProcess;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  private stopping = false;
  private state: DesktopBackendState = { status: 'idle' };
  private lastStartOptions: DesktopBackendStartOptions | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;

  constructor(private readonly options: DesktopBackendManagerOptions) {}

  getState(): DesktopBackendState {
    return { ...this.state };
  }

  start(startOptions: DesktopBackendStartOptions): Promise<DesktopBackendConnection> {
    if (this.stopping) {
      return Promise.reject(new Error('Agendex local API shutdown is in progress'));
    }
    this.lastStartOptions = { ...startOptions };
    if (this.child) {
      const child = this.child;
      if (
        !this.postTo(child, {
          type: 'set-client-dist-dir',
          clientDistDir: startOptions.clientDistDir,
        })
      ) {
        child.kill();
      }
    }
    this.cancelRestart();
    this.restartAttempts = 0;
    return this.startCurrentOptions();
  }

  private startCurrentOptions(): Promise<DesktopBackendConnection> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.startPromise) return this.startPromise;
    if (!this.lastStartOptions) {
      return Promise.reject(new Error('Local API start options are unavailable'));
    }
    this.setState({ status: 'starting' });
    this.startPromise = this.startWorker()
      .catch((error) => {
        if (!this.stopping) {
          this.setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Agendex local API failed to start',
          });
        }
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  setClientDistDir(clientDistDir: string): void {
    if (!clientDistDir) return;
    if (this.lastStartOptions) {
      this.lastStartOptions = { ...this.lastStartOptions, clientDistDir };
    }
    if (!this.child) return;
    const child = this.child;
    if (!this.postTo(child, { type: 'set-client-dist-dir', clientDistDir })) child.kill();
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopCurrent().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async stopCurrent(): Promise<void> {
    this.stopping = true;
    this.cancelRestart();
    this.restartAttempts = 0;
    this.lastStartOptions = null;
    const starting = this.startPromise;
    const child = this.child;
    this.child = null;
    this.connection = null;
    try {
      if (!child) {
        await starting?.catch(() => undefined);
        return;
      }

      this.rejectPendingStart(child, new Error('Agendex local API startup was cancelled'));
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      this.postTo(child, { type: 'shutdown' });
      const graceful = await this.waitForExit(
        exited,
        this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      );
      if (!graceful) {
        child.kill();
        const killed = await this.waitForExit(
          exited,
          this.options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS,
        );
        if (!killed) throw new Error('Failed to terminate the Agendex local API worker');
      }
      await starting?.catch(() => undefined);
    } finally {
      this.stopping = false;
      this.setState({ status: 'idle' });
    }
  }

  private startWorker(): Promise<DesktopBackendConnection> {
    const workerEntry = this.options.workerEntry ?? join(__dirname, 'backend-worker.js');
    const child = this.options.forkWorker(workerEntry, ['--agendex-backend-worker'], {
      env: this.options.getWorkerEnv(),
      serviceName: 'Agendex Local API',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.pipeLogs(child);

    return new Promise<DesktopBackendConnection>((resolve, reject) => {
      let listening = false;
      const timeout = setTimeout(() => {
        this.rejectPendingStart(child, new Error('Timed out starting the Agendex local API'));
        child.kill();
      }, this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS);
      this.pendingStart = { child, reject, timeout };

      child.on('message', (raw) => {
        if (this.child !== child) return;
        const message = parseDesktopBackendWorkerMessage(raw);
        if (!message) return;
        if (message.type === 'listening') {
          listening = true;
          this.clearPendingStart(child);
          this.connection = { port: message.port, token: message.token };
          this.setState({ status: 'indexing' });
          resolve(this.connection);
          return;
        }
        if (message.type === 'index-ready') {
          this.restartAttempts = 0;
          this.setState({ status: 'ready' });
          return;
        }
        this.setState({ status: 'error', message: message.message });
        this.options.log(`Local API ${message.phase} failed: ${message.message}`);
        if (!listening) this.rejectPendingStart(child, new Error(message.message));
        // A fatal message is terminal in both phases. Do not rely on worker-side
        // exit timing before cleanup or an automatic restart can proceed.
        child.kill();
      });

      child.once('spawn', () => {
        const currentStartOptions = this.lastStartOptions;
        if (this.child !== child || this.stopping || !currentStartOptions) {
          child.kill();
          return;
        }
        // A bundle may be quarantined between fork() and spawn. Always boot from
        // the newest directory instead of replaying the stale fork-time value.
        if (
          !this.postTo(child, { type: 'start', ...currentStartOptions, parentPid: process.pid })
        ) {
          child.kill();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        const wasCurrent = this.child === child;
        if (wasCurrent) {
          this.child = null;
          this.connection = null;
        }
        if (!listening) {
          this.rejectPendingStart(
            child,
            new Error(
              this.stopping
                ? 'Agendex local API startup was cancelled'
                : `Agendex local API exited before startup (code ${code})`,
            ),
          );
          return;
        }
        if (!wasCurrent) return;
        if (this.stopping) return;
        const error = new Error(
          this.state.status === 'error'
            ? this.state.message
            : `Agendex local API exited unexpectedly (code ${code})`,
        );
        this.setState({ status: 'error', message: error.message });
        try {
          this.options.onUnexpectedExit?.(error);
        } catch (callbackError) {
          this.options.log('Failed to publish the local API exit', callbackError);
        }
        this.scheduleRestart();
      });
    });
  }

  private scheduleRestart(): void {
    if (this.stopping || !this.lastStartOptions || this.restartTimer) return;
    const delay = Math.min(
      (this.options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS) *
        2 ** Math.min(this.restartAttempts, 5),
      30_000,
    );
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping || this.connection || !this.lastStartOptions) return;
      if (this.child) {
        // A failed worker may take longer to report `exit` than the first retry
        // delay. Keep recovery armed instead of silently abandoning the window.
        this.scheduleRestart();
        return;
      }
      void this.startCurrentOptions()
        .then((connection) => {
          if (this.stopping || this.connection !== connection) return;
          try {
            this.options.onConnectionRestored?.(connection);
          } catch (error) {
            this.options.log('Failed to publish the restored local API connection', error);
          }
        })
        .catch((error) => {
          this.options.log('Failed to restart the Agendex local API', error);
          this.scheduleRestart();
        });
    }, delay);
    this.restartTimer.unref?.();
  }

  private cancelRestart(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private rejectPendingStart(child: UtilityProcess, error: Error): void {
    if (this.pendingStart?.child !== child) return;
    const { reject, timeout } = this.pendingStart;
    this.pendingStart = null;
    clearTimeout(timeout);
    reject(error);
  }

  private clearPendingStart(child: UtilityProcess): void {
    if (this.pendingStart?.child !== child) return;
    clearTimeout(this.pendingStart.timeout);
    this.pendingStart = null;
  }

  private postTo(child: UtilityProcess, message: DesktopBackendParentMessage): boolean {
    try {
      child.postMessage(message);
      return true;
    } catch (error) {
      this.options.log('Failed to communicate with the Agendex local API', error);
      return false;
    }
  }

  private setState(state: DesktopBackendState): void {
    const currentMessage = 'message' in this.state ? this.state.message : undefined;
    const nextMessage = 'message' in state ? state.message : undefined;
    if (this.state.status === state.status && currentMessage === nextMessage) return;
    this.state = state;
    try {
      this.options.onStateChange?.(this.getState());
    } catch (error) {
      this.options.log('Failed to publish the local API state', error);
    }
  }

  private waitForExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void exited.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private pipeLogs(child: UtilityProcess): void {
    child.stdout?.on('data', (chunk) => console.log(String(chunk).trimEnd()));
    child.stderr?.on('data', (chunk) => console.error(String(chunk).trimEnd()));
  }
}
