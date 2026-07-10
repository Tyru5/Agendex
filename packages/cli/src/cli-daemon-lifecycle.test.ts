import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';
import { isRunning, type DaemonPidInfo } from './pid.ts';

const cliEntry = fileURLToPath(new URL('./cli.ts', import.meta.url));

async function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, cliEntry, ...args], {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await Promise.race([child.exited, Bun.sleep(10_000).then(() => null)]);
  if (code === null) {
    child.kill();
    await child.exited;
    throw new Error(`Timed out running agendex ${args.join(' ')}`);
  }
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}

function readPidInfo(path: string): DaemonPidInfo | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DaemonPidInfo;
  } catch {
    return null;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isRunning(pid) && Date.now() < deadline) await Bun.sleep(20);
  if (isRunning(pid)) throw new Error(`Process ${pid} did not exit`);
}

async function waitForPidInfo(
  path: string,
  predicate: (info: DaemonPidInfo) => boolean,
  timeoutMs = 2_000,
): Promise<DaemonPidInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = readPidInfo(path);
    if (info && predicate(info)) return info;
    await Bun.sleep(20);
  }
  throw new Error('Timed out waiting for daemon PID metadata');
}

test('CLI start and stop terminate both supervisor and worker', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agendex cli lifecycle '));
  const configDir = join(tempRoot, '.agendex');
  const pidPath = join(configDir, 'daemon.pid');
  const env = {
    ...process.env,
    AGENDEX_CONFIG_DIR: configDir,
    AGENDEX_DISABLE_LOCAL_IP: '1',
    AGENDEX_HTTP_TIMEOUT_MS: '250',
    AGENDEX_LIVE_SESSION_POLL_MS: '0',
    AGENDEX_PLANNOTATOR_SYNC: '0',
    AGENDEX_SYNC_RESCAN_INTERVAL_MS: '0',
    AGENDEX_WATCHER_REFRESH_INTERVAL_MS: '0',
    HOME: tempRoot,
    USERPROFILE: tempRoot,
  };
  let supervisorPid: number | undefined;
  let workerPid: number | undefined;

  try {
    const started = await runCli(['start'], tempRoot, env);
    expect(started.code).toBe(0);

    const info = readPidInfo(pidPath);
    supervisorPid = info?.pid;
    workerPid = info?.workerPid;
    expect(info?.launcher).toBe('cli');
    expect(Number.isInteger(supervisorPid) && isRunning(supervisorPid as number)).toBe(true);
    expect(Number.isInteger(workerPid) && isRunning(workerPid as number)).toBe(true);

    const stopped = await runCli(['stop'], tempRoot, env);
    expect(stopped.code).toBe(0);
    expect(existsSync(pidPath)).toBe(false);
    expect(supervisorPid !== undefined && isRunning(supervisorPid)).toBe(false);
    expect(workerPid !== undefined && isRunning(workerPid)).toBe(false);
  } finally {
    for (const pid of [workerPid, supervisorPid]) {
      if (!pid || !isRunning(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI start remains singleton while a ready worker is restarting', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agendex cli restart '));
  const configDir = join(tempRoot, '.agendex');
  const pidPath = join(configDir, 'daemon.pid');
  const env = {
    ...process.env,
    AGENDEX_CONFIG_DIR: configDir,
    AGENDEX_DISABLE_LOCAL_IP: '1',
    AGENDEX_HTTP_TIMEOUT_MS: '250',
    AGENDEX_LIVE_SESSION_POLL_MS: '0',
    AGENDEX_PLANNOTATOR_SYNC: '0',
    AGENDEX_SYNC_RESCAN_INTERVAL_MS: '0',
    AGENDEX_WATCHER_REFRESH_INTERVAL_MS: '0',
    HOME: tempRoot,
    USERPROFILE: tempRoot,
  };
  let supervisorPid: number | undefined;
  let workerPid: number | undefined;

  try {
    expect((await runCli(['start'], tempRoot, env)).code).toBe(0);
    const first = readPidInfo(pidPath);
    supervisorPid = first?.pid;
    workerPid = first?.workerPid;
    expect(Number.isInteger(supervisorPid)).toBe(true);
    expect(Number.isInteger(workerPid)).toBe(true);

    process.kill(workerPid as number, 'SIGKILL');
    await waitForProcessExit(workerPid as number);

    const secondStart = await runCli(['start'], tempRoot, env);
    expect(secondStart.code).toBe(0);
    expect(secondStart.stdout).toContain(`daemon already running (PID ${supervisorPid})`);
    expect(readPidInfo(pidPath)?.pid).toBe(supervisorPid);

    expect((await runCli(['stop'], tempRoot, env)).code).toBe(0);
    expect(supervisorPid !== undefined && isRunning(supervisorPid)).toBe(false);
  } finally {
    for (const pid of [workerPid, supervisorPid]) {
      if (!pid || !isRunning(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('initial startup drains an orphaned worker before a replacement starts', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agendex cli initial crash '));
  const configDir = join(tempRoot, '.agendex');
  const pidPath = join(configDir, 'daemon.pid');
  const env = {
    ...process.env,
    AGENDEX_CONFIG_DIR: configDir,
    AGENDEX_DISABLE_LOCAL_IP: '1',
    AGENDEX_HTTP_TIMEOUT_MS: '250',
    AGENDEX_LIVE_SESSION_POLL_MS: '0',
    AGENDEX_PLANNOTATOR_SYNC: '0',
    AGENDEX_SYNC_RESCAN_INTERVAL_MS: '0',
    AGENDEX_WATCHER_REFRESH_INTERVAL_MS: '0',
    HOME: tempRoot,
    USERPROFILE: tempRoot,
  };
  let oldSupervisorPid: number | undefined;
  let oldWorkerPid: number | undefined;
  let replacementSupervisorPid: number | undefined;
  let replacementWorkerPid: number | undefined;

  try {
    const firstStart = runCli(['start'], tempRoot, {
      ...env,
      AGENDEX_DAEMON_READY_DELAY_MS: '2000',
    });
    const initializing = await waitForPidInfo(pidPath, (info) => info.ready === false);
    oldSupervisorPid = initializing.pid;
    oldWorkerPid = initializing.workerPid;
    expect(Number.isInteger(oldWorkerPid)).toBe(true);

    process.kill(oldSupervisorPid, 'SIGKILL');
    const replacementStart = runCli(['start'], tempRoot, env);

    expect((await firstStart).code).toBe(1);
    expect((await replacementStart).code).toBe(0);
    expect(oldWorkerPid !== undefined && isRunning(oldWorkerPid)).toBe(false);

    const replacement = await waitForPidInfo(pidPath, (info) => info.ready === true);
    replacementSupervisorPid = replacement.pid;
    replacementWorkerPid = replacement.workerPid;
    expect(replacementSupervisorPid).not.toBe(oldSupervisorPid);
    expect(replacementWorkerPid).not.toBe(oldWorkerPid);

    expect((await runCli(['stop'], tempRoot, env)).code).toBe(0);
  } finally {
    for (const pid of [
      oldWorkerPid,
      oldSupervisorPid,
      replacementWorkerPid,
      replacementSupervisorPid,
    ]) {
      if (!pid || !isRunning(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI stop drains a worker orphaned by a crashed supervisor', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agendex cli stop orphan '));
  const configDir = join(tempRoot, '.agendex');
  const pidPath = join(configDir, 'daemon.pid');
  const env = {
    ...process.env,
    AGENDEX_CONFIG_DIR: configDir,
    AGENDEX_DISABLE_LOCAL_IP: '1',
    AGENDEX_HTTP_TIMEOUT_MS: '250',
    AGENDEX_LIVE_SESSION_POLL_MS: '0',
    AGENDEX_PLANNOTATOR_SYNC: '0',
    AGENDEX_SYNC_RESCAN_INTERVAL_MS: '0',
    AGENDEX_WATCHER_REFRESH_INTERVAL_MS: '0',
    HOME: tempRoot,
    USERPROFILE: tempRoot,
  };
  let supervisorPid: number | undefined;
  let workerPid: number | undefined;

  try {
    expect((await runCli(['start'], tempRoot, env)).code).toBe(0);
    const running = await waitForPidInfo(pidPath, (info) => info.ready === true);
    supervisorPid = running.pid;
    workerPid = running.workerPid;
    expect(Number.isInteger(workerPid)).toBe(true);

    process.kill(supervisorPid, 'SIGKILL');
    const stopped = await runCli(['stop'], tempRoot, env);
    expect(stopped.code).toBe(0);
    expect(workerPid !== undefined && isRunning(workerPid)).toBe(false);
    expect(existsSync(pidPath)).toBe(false);
  } finally {
    for (const pid of [workerPid, supervisorPid]) {
      if (!pid || !isRunning(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
