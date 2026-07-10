import { join } from 'node:path';
import { getConfigDir, getHomeDir } from '@agendex/shared';
import {
  acquireDaemonStartLock,
  isRunning,
  readPidInfo,
  removePid,
} from 'agendex-cli/daemon-runtime';
import type { UtilityProcess } from 'electron';
import type { CloudCreds } from './cloud-auth.ts';
import {
  parseDesktopDaemonWorkerMessage,
  type DesktopDaemonParentMessage,
} from './desktop-daemon-protocol.ts';

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 3_000;

export interface DesktopDaemonManagerOptions {
  isDev: boolean;
  rotateCloudToken: (previousToken: string, token: string) => CloudCreds | null;
  onAuthExpired: () => void | Promise<void>;
  log: (message: string, error?: unknown) => void;
  workerEntry?: string;
  forkWorker: typeof import('electron').utilityProcess.fork;
}

export class DesktopDaemonManager {
  private child: UtilityProcess | null = null;
  private startPromise: Promise<'started' | 'already-running'> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopping = false;
  private readonly daemonConfigDir: string;

  constructor(private readonly options: DesktopDaemonManagerOptions) {
    this.daemonConfigDir = process.env.AGENDEX_CONFIG_DIR?.trim()
      ? getConfigDir()
      : join(getHomeDir(), options.isDev ? '.agendex-dev' : '.agendex');
  }

  ensureRunning(credentials: CloudCreds): Promise<'started' | 'already-running'> {
    if (this.stopping) return Promise.reject(new Error('Daemon shutdown is in progress'));
    if (this.startPromise) return this.startPromise;
    if (this.child) {
      this.post({ type: 'credentials-updated', credentials });
      return Promise.resolve('already-running');
    }

    this.startPromise = this.start(credentials).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  updateCredentials(credentials: CloudCreds): void {
    if (this.child) this.post({ type: 'credentials-updated', credentials });
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopChild().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async stopChild(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) {
      this.stopping = false;
      return;
    }

    const pid = child.pid;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    this.post({ type: 'shutdown' });

    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS)),
    ]);
    if (!graceful) child.kill();
    if (pid) removePid(pid, { configDir: this.daemonConfigDir });
    if (this.child === child) this.child = null;
    this.stopping = false;
  }

  private async start(credentials: CloudCreds): Promise<'started' | 'already-running'> {
    const pathOptions = { configDir: this.daemonConfigDir };
    const existing = readPidInfo(pathOptions);
    if (existing && isRunning(existing.pid)) {
      const orphanedDesktopWorker =
        existing.launcher === 'desktop' &&
        existing.parentPid !== undefined &&
        !isRunning(existing.parentPid);
      if (!orphanedDesktopWorker) return 'already-running';

      // A utility worker normally exits as soon as its parent disappears. Give
      // its watchdog time to run, but never kill a live PID that the OS may have
      // recycled for an unrelated process.
      await new Promise((resolve) => setTimeout(resolve, 1_250));
      if (isRunning(existing.pid)) return 'already-running';
    }
    if (existing) removePid(existing.pid, pathOptions);

    const releaseStartLock = acquireDaemonStartLock(pathOptions);
    if (!releaseStartLock) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const pending = readPidInfo(pathOptions);
      if (pending && isRunning(pending.pid)) return 'already-running';
      throw new Error('Daemon startup is already in progress');
    }

    try {
      const workerEntry = this.options.workerEntry ?? join(__dirname, 'daemon-worker.js');
      const env = { ...process.env };
      if (this.options.isDev) env.AGENDEX_DEV = '1';
      else delete env.AGENDEX_DEV;

      if (this.stopping) throw new Error('Daemon startup was cancelled');
      const child = this.options.forkWorker(workerEntry, [], {
        env,
        serviceName: 'Agendex Sync',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      this.pipeLogs(child);

      return await new Promise<'started'>((resolve, reject) => {
        let ready = false;
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('Timed out waiting for the Agendex daemon worker'));
        }, START_TIMEOUT_MS);

        child.on('message', (raw) => {
          const message = parseDesktopDaemonWorkerMessage(raw);
          if (!message) return;
          if (message.type === 'ready') {
            ready = true;
            clearTimeout(timeout);
            resolve('started');
            return;
          }
          if (message.type === 'token-rotated') {
            const current = this.options.rotateCloudToken(message.previousToken, message.token);
            if (current) this.updateCredentials(current);
            return;
          }
          if (message.type === 'auth-expired') {
            void this.options.onAuthExpired();
            return;
          }
          this.options.log(message.message);
        });

        child.once('spawn', () => {
          child.postMessage({
            type: 'start',
            credentials,
            parentPid: process.pid,
          } satisfies DesktopDaemonParentMessage);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          if (this.child === child) this.child = null;
          if (!ready && !this.stopping) {
            reject(new Error(`Agendex daemon worker exited before startup (code ${code})`));
          }
        });
      });
    } finally {
      releaseStartLock();
    }
  }

  private post(message: DesktopDaemonParentMessage): void {
    try {
      this.child?.postMessage(message);
    } catch (error) {
      this.options.log('Failed to communicate with the Agendex daemon worker', error);
    }
  }

  private pipeLogs(child: UtilityProcess): void {
    child.stdout?.on('data', (chunk) => console.log(String(chunk).trimEnd()));
    child.stderr?.on('data', (chunk) => console.error(String(chunk).trimEnd()));
  }
}
