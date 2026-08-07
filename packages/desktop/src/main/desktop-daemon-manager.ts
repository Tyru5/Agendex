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
const DEFAULT_EXTERNAL_STATE_POLL_MS = 1_000;

export interface DesktopDaemonTimings {
  startTimeoutMs: number;
  stopTimeoutMs: number;
  killTimeoutMs: number;
  orphanGraceMs: number;
  contentionWaitMs: number;
  restartDelayMs: number;
  externalStatePollMs: number;
}

export type DesktopDaemonState =
  | { status: 'idle' }
  | { status: 'starting'; message?: string }
  | { status: 'indexing'; message?: string }
  | { status: 'ready' }
  | { status: 'stopping' }
  | { status: 'error'; message: string };

export interface DesktopDaemonManagerOptions {
  isDev: boolean;
  rotateCloudToken: (previousToken: string, token: string, accountId?: string) => CloudCreds | null;
  onAuthExpired: (failedToken: string) => void | Promise<void>;
  log: (message: string, error?: unknown) => void;
  workerEntry?: string;
  forkWorker: typeof import('electron').utilityProcess.fork;
  /** Extra/override env for the utility worker (e.g. AGENDEX_HOME / AGENDEX_CONFIG_DIR). */
  getWorkerEnv?: () => NodeJS.ProcessEnv;
  onStateChange?: (state: DesktopDaemonState) => void;
  isProcessRunning?: (pid: number) => boolean;
  isDaemonProcess?: (pid: number) => boolean;
  isPidInfoCurrent?: (info: DaemonPidInfo) => boolean;
  timings?: Partial<DesktopDaemonTimings>;
}

export class DesktopDaemonManager {
  private child: UtilityProcess | null = null;
  private childBooted = false;
  private startPromise: Promise<'started' | 'already-running'> | null = null;
  private stopPromise: Promise<void> | null = null;
  private pendingBoot: { child: UtilityProcess; reject: (error: Error) => void } | null = null;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private externalStateTimer: ReturnType<typeof setTimeout> | null = null;
  private externalDaemonPid: number | null = null;
  private restartAttempts = 0;
  private latestCredentials: CloudCreds | null = null;
  private readonly daemonConfigDir: string;
  private readonly timings: DesktopDaemonTimings;
  private state: DesktopDaemonState = { status: 'idle' };

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
      externalStatePollMs: options.timings?.externalStatePollMs ?? DEFAULT_EXTERNAL_STATE_POLL_MS,
    };
  }

  ensureRunning(credentials: CloudCreds): Promise<'started' | 'already-running'> {
    if (this.stopping) return Promise.reject(new Error('Daemon shutdown is in progress'));
    this.latestCredentials = credentials;
    if (this.startPromise) {
      if (this.child) {
        const child = this.child;
        if (!this.postTo(child, { type: 'credentials-updated', credentials })) child.kill();
      }
      return this.startPromise;
    }
    if (this.child) {
      if (!this.childBooted) {
        return Promise.reject(new Error('Daemon worker is not operational'));
      }
      const child = this.child;
      if (!this.postTo(child, { type: 'credentials-updated', credentials })) child.kill();
      return Promise.resolve('already-running');
    }

    this.setState({ status: 'starting', message: 'Starting sync service' });
    this.startPromise = this.start()
      .catch((error) => {
        if (!this.stopping) {
          this.setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Failed to start sync service',
          });
          this.scheduleRestart();
        }
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  updateCredentials(credentials: CloudCreds): void {
    this.latestCredentials = credentials;
    if (this.child) {
      const child = this.child;
      if (!this.postTo(child, { type: 'credentials-updated', credentials })) child.kill();
    }
  }

  getState(): DesktopDaemonState {
    return { ...this.state };
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
    this.setState({ status: 'stopping' });
    this.latestCredentials = null;
    this.restartAttempts = 0;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.cancelExternalStateMonitor();
    let stopped = false;
    let releaseStartLock: (() => void) | null = null;

    try {
      // A wedged worker can spend up to startTimeoutMs before acknowledging
      // boot. Cancel that owned process instead of making app quit wait for the
      // startup deadline.
      if (this.startPromise && this.child && !this.childBooted) {
        this.rejectPendingBoot(this.child, new Error('Daemon startup was cancelled'));
        this.child.kill();
      }
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
        this.childBooted = false;
      }
      stopped = true;
    } finally {
      releaseStartLock?.();
      if (stopped || !this.child) {
        this.stopping = false;
        this.setState({ status: 'idle' });
      }
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
        this.setState(
          current.ready === false
            ? { status: 'indexing', message: 'Another Agendex process is indexing plans' }
            : { status: 'ready' },
        );
        // We own no child event stream for this process. Keep the lightweight
        // PID monitor active after readiness as well so a later crash cannot
        // leave the renderer claiming sync is connected forever.
        this.monitorExternalDaemon(current.pid);
        return 'already-running';
      }
      if (current) removePid(current.pid, pathOptions);
      if (this.stopping || !this.latestCredentials) {
        throw new Error('Daemon startup was cancelled');
      }

      const workerEntry = this.options.workerEntry ?? join(__dirname, 'daemon-worker.js');
      this.cancelExternalStateMonitor();
      const baseEnv = this.options.getWorkerEnv ? this.options.getWorkerEnv() : { ...process.env };
      const env = { ...baseEnv };
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
      this.childBooted = false;
      this.pipeLogs(child);

      return await new Promise<'started'>((resolve, reject) => {
        let booted = false;
        let ready = false;
        let timedOut = false;
        let settled = false;
        let killDeadline: ReturnType<typeof setTimeout> | undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const clearBootWait = () => {
          if (timeout) clearTimeout(timeout);
          if (killDeadline) clearTimeout(killDeadline);
          if (this.pendingBoot?.child === child) this.pendingBoot = null;
        };
        const rejectBoot = (error: Error) => {
          if (settled) return;
          settled = true;
          clearBootWait();
          reject(error);
        };
        const resolveBoot = () => {
          if (settled) return;
          settled = true;
          clearBootWait();
          resolve('started');
        };
        this.pendingBoot = { child, reject: rejectBoot };
        timeout = setTimeout(() => {
          timedOut = true;
          killDeadline = setTimeout(
            () => rejectBoot(new Error('Timed out terminating the Agendex daemon worker')),
            this.timings.killTimeoutMs,
          );
          child.kill();
        }, this.timings.startTimeoutMs);

        child.on('message', (raw) => {
          if (this.child !== child) return;
          const message = parseDesktopDaemonWorkerMessage(raw);
          if (!message) return;
          if (message.type === 'booted') {
            if (timedOut || settled || this.stopping) return;
            booted = true;
            this.childBooted = true;
            this.setState({ status: 'starting', message: 'Preparing plan index' });
            resolveBoot();
            return;
          }
          if (message.type === 'status') {
            if (!booted || this.stopping) return;
            this.setState({
              status: 'indexing',
              message: message.message ?? 'Scanning plan folders',
            });
            return;
          }
          if (message.type === 'ready') {
            if (!booted || timedOut || this.stopping) return;
            ready = true;
            this.restartAttempts = 0;
            this.setState({ status: 'ready' });
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
          this.setState({ status: 'error', message: message.message });
          this.options.log(message.message);
          if (!booted) rejectBoot(new Error(message.message));
          child.kill();
        });

        child.once('spawn', () => {
          const credentials = this.latestCredentials;
          if (this.child !== child || timedOut || this.stopping || !credentials) {
            child.kill();
            return;
          }
          if (!this.postTo(child, { type: 'start', credentials, parentPid: process.pid })) {
            child.kill();
          }
        });
        child.once('exit', (code) => {
          clearBootWait();
          if (this.child === child) {
            this.child = null;
            this.childBooted = false;
          }
          if (!booted) {
            rejectBoot(
              new Error(
                timedOut
                  ? 'Timed out waiting for the Agendex daemon worker'
                  : `Agendex daemon worker exited before startup (code ${code})`,
              ),
            );
          } else if (!this.stopping) {
            if (this.state.status !== 'error') {
              this.setState({
                status: 'error',
                message: ready
                  ? `Sync service exited unexpectedly (code ${code})`
                  : `Sync service stopped while indexing (code ${code})`,
              });
            }
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
    const restartDelayMs = Math.min(
      this.timings.restartDelayMs * 2 ** Math.min(this.restartAttempts, 5),
      30_000,
    );
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      const credentials = this.latestCredentials;
      if (this.stopping || !credentials) return;
      if (this.child) {
        // A failed utility may still be delivering its exit event when the
        // first retry wakes. Keep recovery armed until ownership is released.
        if (!this.childBooted) this.scheduleRestart();
        return;
      }
      void this.ensureRunning(credentials).catch((error) => {
        this.options.log('Failed to restart the Agendex daemon worker', error);
      });
    }, restartDelayMs);
    this.restartTimer.unref?.();
  }

  private monitorExternalDaemon(pid: number): void {
    this.cancelExternalStateMonitor();
    this.externalDaemonPid = pid;
    const poll = () => {
      this.externalStateTimer = null;
      if (this.stopping || this.child || !this.latestCredentials) return;

      const current = readPidInfo({ configDir: this.daemonConfigDir });
      if (!current) {
        this.setState({ status: 'error', message: 'External sync service stopped' });
        this.externalDaemonPid = null;
        this.scheduleRestart();
        return;
      }
      const sameValidatedProcess =
        current.pid === this.externalDaemonPid &&
        this.pidInfoIsCurrent(current) &&
        this.processIsRunning(current.pid);
      if (!sameValidatedProcess && !this.pidInfoMatchesRunningDaemon(current)) {
        this.setState({ status: 'error', message: 'External sync service stopped' });
        this.externalDaemonPid = null;
        this.scheduleRestart();
        return;
      }
      this.externalDaemonPid = current.pid;

      if (current.ready !== false) {
        this.restartAttempts = 0;
        this.setState({ status: 'ready' });
        this.externalStateTimer = setTimeout(poll, this.timings.externalStatePollMs);
        this.externalStateTimer.unref?.();
        return;
      }

      this.setState({
        status: 'indexing',
        message: 'Another Agendex process is indexing plans',
      });
      this.externalStateTimer = setTimeout(poll, this.timings.externalStatePollMs);
      this.externalStateTimer.unref?.();
    };

    this.externalStateTimer = setTimeout(poll, this.timings.externalStatePollMs);
    this.externalStateTimer.unref?.();
  }

  private cancelExternalStateMonitor(): void {
    if (this.externalStateTimer) clearTimeout(this.externalStateTimer);
    this.externalStateTimer = null;
    this.externalDaemonPid = null;
  }

  private rejectPendingBoot(child: UtilityProcess, error: Error): void {
    if (this.pendingBoot?.child !== child) return;
    this.pendingBoot.reject(error);
  }

  private setState(state: DesktopDaemonState): void {
    const currentMessage = 'message' in this.state ? this.state.message : undefined;
    const nextMessage = 'message' in state ? state.message : undefined;
    if (this.state.status === state.status && currentMessage === nextMessage) return;
    this.state = state;
    try {
      this.options.onStateChange?.(this.getState());
    } catch (error) {
      this.options.log('Failed to publish Agendex daemon state', error);
    }
  }

  private pipeLogs(child: UtilityProcess): void {
    child.stdout?.on('data', (chunk) => console.log(String(chunk).trimEnd()));
    child.stderr?.on('data', (chunk) => console.error(String(chunk).trimEnd()));
  }
}
