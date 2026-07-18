import { join } from 'node:path';
import { getConfigDir, getHomeDir } from '@agendex/shared';
import {
  acquireDaemonStartLock,
  isAgendexDaemonProcess,
  isDaemonPidInfoCurrent,
  isDaemonPidInfoRunning,
  isRunning,
  readPidInfo,
  removePid,
} from '@agendex/daemon-runtime';
import type { DaemonPidInfo } from '@agendex/daemon-runtime';
import type { UtilityProcess } from 'electron';
import type { CloudCreds } from './cloud-auth.ts';
import {
  parseDesktopDaemonWorkerMessage,
  type DesktopDaemonParentMessage,
} from './desktop-daemon-protocol.ts';

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const DEFAULT_KILL_TIMEOUT_MS = 3_000;
const DEFAULT_ORPHAN_GRACE_MS = 3_000;
const DEFAULT_CONTENTION_WAIT_MS = 500;
const DEFAULT_RESTART_DELAY_MS = 1_000;

export interface DesktopDaemonTimings {
  startTimeoutMs: number;
  stopTimeoutMs: number;
  killTimeoutMs: number;
  orphanGraceMs: number;
  contentionWaitMs: number;
  restartDelayMs: number;
}

export interface DesktopDaemonManagerOptions {
  isDev: boolean;
  rotateCloudToken: (previousToken: string, token: string, accountId?: string) => CloudCreds | null;
  onAuthExpired: (failedToken: string) => void | Promise<void>;
  log: (message: string, error?: unknown) => void;
  workerEntry?: string;
  forkWorker: typeof import('electron').utilityProcess.fork;
  isProcessRunning?: (pid: number) => boolean;
  isDaemonProcess?: (pid: number) => boolean;
  isPidInfoCurrent?: (info: DaemonPidInfo) => boolean;
  timings?: Partial<DesktopDaemonTimings>;
}

export class DesktopDaemonManager {
  private child: UtilityProcess | null = null;
  private childReady = false;
  private startPromise: Promise<'started' | 'already-running'> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private latestCredentials: CloudCreds | null = null;
  private readonly daemonConfigDir: string;
  private readonly timings: DesktopDaemonTimings;

  constructor(private readonly options: DesktopDaemonManagerOptions) {
    this.daemonConfigDir = process.env.AGENDEX_CONFIG_DIR?.trim()
      ? getConfigDir()
      : join(getHomeDir(), options.isDev ? '.agendex-dev' : '.agendex');
    this.timings = {
      startTimeoutMs: options.timings?.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
      stopTimeoutMs: options.timings?.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      killTimeoutMs: options.timings?.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS,
      orphanGraceMs: options.timings?.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS,
      contentionWaitMs: options.timings?.contentionWaitMs ?? DEFAULT_CONTENTION_WAIT_MS,
      restartDelayMs: options.timings?.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS,
    };
  }

  ensureRunning(credentials: CloudCreds): Promise<'started' | 'already-running'> {
    if (this.stopping) return Promise.reject(new Error('Daemon shutdown is in progress'));
    this.latestCredentials = credentials;
    if (this.startPromise) {
      if (this.child) this.postTo(this.child, { type: 'credentials-updated', credentials });
      return this.startPromise;
    }
    if (this.child) {
      if (!this.childReady) {
        return Promise.reject(new Error('Daemon worker is not operational'));
      }
      this.postTo(this.child, { type: 'credentials-updated', credentials });
      return Promise.resolve('already-running');
    }

    this.startPromise = this.start()
      .catch((error) => {
        this.scheduleRestart();
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  updateCredentials(credentials: CloudCreds): void {
    this.latestCredentials = credentials;
    if (this.child) this.postTo(this.child, { type: 'credentials-updated', credentials });
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
    this.latestCredentials = null;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    let stopped = false;
    let releaseStartLock: (() => void) | null = null;

    try {
      if (this.startPromise) await this.startPromise.catch(() => undefined);

      const pathOptions = { configDir: this.daemonConfigDir };
      releaseStartLock =
        acquireDaemonStartLock(pathOptions) ??
        (await this.waitForStartLock(pathOptions, { allowStopping: true }));
      if (!releaseStartLock) throw new Error('Daemon lifecycle operation is still in progress');

      const child = this.child;
      if (!child) {
        stopped = true;
        return;
      }

      const pid = child.pid;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      this.postTo(child, { type: 'shutdown' });

      const graceful = await this.waitForExit(exited, this.timings.stopTimeoutMs);
      if (!graceful) {
        child.kill();
        const killed = await this.waitForExit(exited, this.timings.killTimeoutMs);
        if (!killed) throw new Error('Failed to terminate the Agendex daemon worker');
      }

      if (pid) removePid(pid, { configDir: this.daemonConfigDir });
      if (this.child === child) {
        this.child = null;
        this.childReady = false;
      }
      stopped = true;
    } finally {
      releaseStartLock?.();
      if (stopped || !this.child) this.stopping = false;
    }
  }

  private async start(): Promise<'started' | 'already-running'> {
    const pathOptions = { configDir: this.daemonConfigDir };
    const observed = readPidInfo(pathOptions);
    const observedIsCurrent = observed ? this.pidInfoIsCurrent(observed) : false;
    const orphanPid =
      observedIsCurrent &&
      observed?.launcher === 'desktop' &&
      this.processIsRunning(observed.pid) &&
      this.processLooksLikeDaemon(observed) &&
      observed.parentPid !== undefined &&
      !this.processIsRunning(observed.parentPid)
        ? observed.pid
        : observedIsCurrent &&
            observed?.launcher === 'cli' &&
            !this.processIsRunning(observed.pid) &&
            observed.workerPid !== undefined &&
            this.processIsDaemon(observed.workerPid)
          ? observed.workerPid
          : null;
    if (orphanPid !== null) {
      // A utility worker normally exits as soon as its parent disappears. Give
      // its watchdog time to run, but never kill a live PID that the OS may have
      // recycled for an unrelated process.
      const exited = await this.waitForProcessToExit(orphanPid, this.timings.orphanGraceMs);
      if (!exited && !this.stopping) {
        throw new Error('Previous daemon worker is still shutting down');
      }
    }

    if (this.stopping) throw new Error('Daemon startup was cancelled');
    const releaseStartLock =
      acquireDaemonStartLock(pathOptions) ?? (await this.waitForStartLock(pathOptions));
    if (!releaseStartLock) {
      throw new Error('Daemon startup is already in progress');
    }

    try {
      const current = readPidInfo(pathOptions);
      if (current && this.pidInfoMatchesRunningDaemon(current)) {
        return 'already-running';
      }
      if (current) removePid(current.pid, pathOptions);
      if (this.stopping || !this.latestCredentials) {
        throw new Error('Daemon startup was cancelled');
      }

      const workerEntry = this.options.workerEntry ?? join(__dirname, 'daemon-worker.js');
      const env = { ...process.env };
      if (this.options.isDev) env.AGENDEX_DEV = '1';
      else delete env.AGENDEX_DEV;

      // Script args land on the worker's process.argv. Do not put the marker in execArgv —
      // Node rejects unrecognized -- flags at startup ("bad option").
      const child = this.options.forkWorker(workerEntry, ['--agendex-daemon-worker'], {
        env,
        serviceName: 'Agendex Sync',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      this.childReady = false;
      this.pipeLogs(child);

      return await new Promise<'started'>((resolve, reject) => {
        let ready = false;
        let timedOut = false;
        let killDeadline: ReturnType<typeof setTimeout> | undefined;
        const timeout = setTimeout(() => {
          timedOut = true;
          killDeadline = setTimeout(
            () => reject(new Error('Timed out terminating the Agendex daemon worker')),
            this.timings.killTimeoutMs,
          );
          child.kill();
        }, this.timings.startTimeoutMs);

        child.on('message', (raw) => {
          const message = parseDesktopDaemonWorkerMessage(raw);
          if (!message) return;
          if (message.type === 'ready') {
            if (timedOut) return;
            ready = true;
            this.childReady = true;
            clearTimeout(timeout);
            resolve('started');
            return;
          }
          if (message.type === 'token-rotated') {
            try {
              const currentCredentials = this.options.rotateCloudToken(
                message.previousToken,
                message.token,
                message.accountId,
              );
              if (currentCredentials) this.updateCredentials(currentCredentials);
            } catch (error) {
              this.options.log('Failed to persist a rotated cloud token', error);
            }
            return;
          }
          if (message.type === 'auth-expired') {
            try {
              void Promise.resolve(this.options.onAuthExpired(message.failedToken)).catch((error) =>
                this.options.log('Failed to handle expired daemon credentials', error),
              );
            } catch (error) {
              this.options.log('Failed to handle expired daemon credentials', error);
            }
            return;
          }
          this.options.log(message.message);
        });

        child.once('spawn', () => {
          const credentials = this.latestCredentials;
          if (timedOut || this.stopping || !credentials) {
            child.kill();
            return;
          }
          if (!this.postTo(child, { type: 'start', credentials, parentPid: process.pid })) {
            child.kill();
          }
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          if (killDeadline) clearTimeout(killDeadline);
          if (this.child === child) {
            this.child = null;
            this.childReady = false;
          }
          if (!ready) {
            reject(
              new Error(
                timedOut
                  ? 'Timed out waiting for the Agendex daemon worker'
                  : `Agendex daemon worker exited before startup (code ${code})`,
              ),
            );
          } else {
            this.scheduleRestart();
          }
        });
      });
    } finally {
      releaseStartLock();
    }
  }

  private processIsRunning(pid: number): boolean {
    return (this.options.isProcessRunning ?? isRunning)(pid);
  }

  private processIsDaemon(pid: number): boolean {
    if (!this.processIsRunning(pid)) return false;
    return (this.options.isDaemonProcess ?? isAgendexDaemonProcess)(pid);
  }

  private pidInfoIsCurrent(info: DaemonPidInfo): boolean {
    return (this.options.isPidInfoCurrent ?? isDaemonPidInfoCurrent)(info);
  }

  private pidInfoMatchesRunningDaemon(info: DaemonPidInfo): boolean {
    if (!this.pidInfoIsCurrent(info)) return false;
    if (this.options.isDaemonProcess) {
      return this.processIsDaemon(info.pid);
    }
    // Honor injected liveness/freshness; force provenance checks already satisfied above.
    return isDaemonPidInfoRunning(info, {
      processRunning: this.processIsRunning(info.pid),
      currentHostname: info.hostname,
      currentBootId: info.bootId ?? null,
    });
  }

  /** Orphan workers may still look like Electron utilities after the parent exits. */
  private processLooksLikeDaemon(info: DaemonPidInfo): boolean {
    if (this.options.isDaemonProcess) return this.processIsDaemon(info.pid);
    if (this.processIsDaemon(info.pid)) return true;
    // Force parent-alive so desktop utility ownership can match after Electron exits.
    return isDaemonPidInfoRunning(info, { parentProcessRunning: true });
  }

  private postTo(child: UtilityProcess, message: DesktopDaemonParentMessage): boolean {
    try {
      child.postMessage(message);
      return true;
    } catch (error) {
      this.options.log('Failed to communicate with the Agendex daemon worker', error);
      return false;
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

  private delay(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, timeoutMs));
  }

  private async waitForProcessToExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.processIsRunning(pid)) return true;
      await this.delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    return !this.processIsRunning(pid);
  }

  private async waitForStartLock(
    pathOptions: { configDir: string },
    options: { allowStopping?: boolean } = {},
  ): Promise<(() => void) | null> {
    const deadline = Date.now() + this.timings.startTimeoutMs;
    while (Date.now() < deadline) {
      if (this.stopping && !options.allowStopping) throw new Error('Daemon startup was cancelled');
      const release = acquireDaemonStartLock(pathOptions);
      if (release) return release;
      await this.delay(Math.min(50, this.timings.contentionWaitMs));
    }
    return null;
  }

  private scheduleRestart(): void {
    if (this.stopping || !this.latestCredentials || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      const credentials = this.latestCredentials;
      if (this.stopping || this.child || !credentials) return;
      void this.ensureRunning(credentials).catch((error) => {
        this.options.log('Failed to restart the Agendex daemon worker', error);
      });
    }, this.timings.restartDelayMs);
  }

  private pipeLogs(child: UtilityProcess): void {
    child.stdout?.on('data', (chunk) => console.log(String(chunk).trimEnd()));
    child.stderr?.on('data', (chunk) => console.error(String(chunk).trimEnd()));
  }
}
