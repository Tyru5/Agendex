import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'bun:test';
import {
  acquireDaemonStartLock,
  isDaemonPidInfoCurrent,
  isDaemonPidInfoRunning,
  readPidInfo,
  readWindowsDesktopDaemonInfoFromWsl,
} from './pid.ts';

const originalConfigDir = process.env.AGENDEX_CONFIG_DIR;
let tempRoot = '';

function useTempConfigDir() {
  tempRoot = mkdtempSync(join(tmpdir(), 'agendex pid path with spaces '));
  process.env.AGENDEX_CONFIG_DIR = join(tempRoot, '.agendex');
  mkdirSync(process.env.AGENDEX_CONFIG_DIR, { recursive: true });
}

function reclaimPathFor(lockPath: string): string {
  const raw = readFileSync(lockPath, 'utf8');
  const stat = statSync(lockPath);
  const key = createHash('sha256')
    .update([stat.dev, stat.ino, stat.mtimeMs, stat.birthtimeMs, stat.size, raw].join('\0'))
    .digest('hex');
  return `${lockPath}.reclaim-${key}`;
}

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalConfigDir;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

test('daemon startup lock is exclusive and releases on paths with spaces', () => {
  useTempConfigDir();
  const release = acquireDaemonStartLock();
  expect(typeof release).toBe('function');
  const lock = JSON.parse(
    readFileSync(join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock'), 'utf8'),
  ) as { ownerToken?: unknown };
  expect(typeof lock.ownerToken).toBe('string');
  expect(acquireDaemonStartLock()).toBeNull();
  release?.();
  const reacquired = acquireDaemonStartLock();
  expect(typeof reacquired).toBe('function');
  reacquired?.();
});

test('daemon PID metadata rejects records from another host or OS boot', () => {
  const runtime = {
    currentHostname: 'current-host',
    currentBootId: 'boot-current',
  };

  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'other-host', bootId: 'boot-current' },
      runtime,
    ),
  ).toBe(false);
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'boot-previous' },
      runtime,
    ),
  ).toBe(false);
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'CURRENT-HOST', bootId: 'boot-current' },
      runtime,
    ),
  ).toBe(true);
  // Writer/probe may disagree on win32 BootId vs LastBootUpTime; treat as inconclusive.
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:0x12' },
      { currentHostname: 'current-host', currentBootId: 'win32:638123456789012345' },
    ),
  ).toBe(true);
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:0x12' },
      { currentHostname: 'current-host', currentBootId: 'win32:0x13' },
    ),
  ).toBe(false);
});

test('daemon PID ownership accepts only CLI or marked desktop daemon commands', () => {
  const info = {
    pid: process.pid,
    hostname: 'current-host',
    bootId: 'boot-current',
  };
  const runtime = {
    currentHostname: 'current-host',
    currentBootId: 'boot-current',
    processRunning: true,
  };

  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: '/usr/local/bin/agendex start --daemon',
    }),
  ).toBe(true);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: 'Agendex.exe --type=utility --utility-sub-type=network',
    }),
  ).toBe(false);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: 'Agendex.exe --type=utility --agendex-daemon-worker',
    }),
  ).toBe(true);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: 'RenamedDesktop.exe --type=utility --agendex-daemon-worker',
    }),
  ).toBe(true);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: 'unrelated-process --daemon',
    }),
  ).toBe(false);
});

test('desktop launcher ownership accepts Electron utility processes without visible Node args', () => {
  const info = {
    pid: process.pid,
    hostname: 'current-host',
    bootId: 'boot-current',
    launcher: 'desktop' as const,
    parentPid: process.pid,
  };
  const runtime = {
    currentHostname: 'current-host',
    currentBootId: 'boot-current',
    processRunning: true,
    parentProcessRunning: true,
  };

  // Real Electron utilityProcess listings often omit fork() Node args from `ps`/WMI.
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand:
        'Agendex Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService',
    }),
  ).toBe(true);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: 'RenamedDesktop.exe --type=utility --utility-sub-type=network',
    }),
  ).toBe(false);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: 'Agendex.exe --type=utility',
    }),
  ).toBe(false);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      parentProcessRunning: false,
      processCommand:
        'Agendex Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService',
    }),
  ).toBe(false);
  expect(
    isDaemonPidInfoRunning(info, {
      ...runtime,
      processCommand: 'unrelated-process --serve',
    }),
  ).toBe(false);
  expect(
    isDaemonPidInfoRunning(
      { ...info, launcher: 'cli' },
      {
        ...runtime,
        processCommand:
          'Agendex Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService',
      },
    ),
  ).toBe(false);
});

test('WSL status reads the selected Windows desktop daemon with Windows process evidence', () => {
  const pidInfo = {
    pid: 456,
    startedAtMs: 1_700_000_000_000,
    hostname: 'windows-host',
    launcher: 'desktop' as const,
    parentPid: 100,
    ready: true,
    bootId: 'win32:0x12',
  };
  const probe = JSON.stringify({
    selectedEnv: 'wsl',
    pidInfo,
    currentHostname: 'windows-host',
    currentBootId: 'win32:0x12',
    processRunning: true,
    processCommand: 'Agendex.exe --type=utility --utility-sub-type=node.mojom.NodeService',
    parentProcessRunning: true,
  });

  expect(
    readWindowsDesktopDaemonInfoFromWsl({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      runProbe: () => probe,
    }),
  ).toEqual(pidInfo);

  expect(
    readWindowsDesktopDaemonInfoFromWsl({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      runProbe: () => JSON.stringify({ ...JSON.parse(probe), selectedEnv: 'native' }),
    }),
  ).toBeNull();

  expect(
    readWindowsDesktopDaemonInfoFromWsl({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      runProbe: () =>
        JSON.stringify({
          ...JSON.parse(probe),
          pidInfo: { ...pidInfo, launcher: 'cli' },
          processCommand: 'agendex start --daemon',
        }),
    }),
  ).toBeNull();

  expect(
    readWindowsDesktopDaemonInfoFromWsl({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      runProbe: () =>
        JSON.stringify({
          ...JSON.parse(probe),
          processCommand: 'unrelated.exe --type=utility',
        }),
    }),
  ).toBeNull();
});

test('Windows desktop daemon fallback is disabled outside WSL', () => {
  let probed = false;
  expect(
    readWindowsDesktopDaemonInfoFromWsl({
      platform: 'linux',
      env: {},
      runProbe: () => {
        probed = true;
        return '{}';
      },
    }),
  ).toBeNull();
  expect(probed).toBe(false);
});

test('legacy PID files retain metadata and require daemon process ownership', () => {
  useTempConfigDir();
  const configDir = process.env.AGENDEX_CONFIG_DIR as string;
  writeFileSync(join(configDir, 'daemon.pid'), String(process.pid));

  const info = readPidInfo({ configDir });
  expect(info?.pid).toBe(process.pid);
  expect(typeof info?.startedAtMs).toBe('number');
  expect(typeof info?.hostname).toBe('string');
  expect(
    info &&
      isDaemonPidInfoCurrent(info, {
        processCommand: 'agendex start --daemon',
      }),
  ).toBe(true);
  expect(
    info &&
      isDaemonPidInfoRunning(info, {
        processCommand: 'agendex start --daemon',
        processRunning: true,
      }),
  ).toBe(true);
  expect(
    info &&
      isDaemonPidInfoRunning(info, {
        processCommand: 'unrelated-process --serve',
        processRunning: true,
      }),
  ).toBe(false);
});

test('daemon startup lock replaces a stale owner', () => {
  useTempConfigDir();
  writeFileSync(
    join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock'),
    JSON.stringify({ pid: 99_999_999, createdAtMs: 0 }),
  );
  const release = acquireDaemonStartLock();
  expect(typeof release).toBe('function');
  expect(acquireDaemonStartLock()).toBeNull();
  release?.();
});

test('daemon startup lock replaces an expired lease even when its PID was reused', () => {
  useTempConfigDir();
  const path = join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock');
  writeFileSync(path, JSON.stringify({ pid: process.pid, createdAtMs: 0 }));
  const staleTime = new Date(Date.now() - 60_000);
  utimesSync(path, staleTime, staleTime);

  const release = acquireDaemonStartLock();
  expect(typeof release).toBe('function');
  release?.();
});

test('does not reclaim a fresh incomplete lock from an older writer', () => {
  useTempConfigDir();
  writeFileSync(join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock'), '');

  expect(acquireDaemonStartLock()).toBeNull();
});

test('reclaims an abandoned incomplete lock after its compatibility grace period', () => {
  useTempConfigDir();
  const path = join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock');
  writeFileSync(path, '');
  const staleTime = new Date(Date.now() - 60_000);
  utimesSync(path, staleTime, staleTime);

  const release = acquireDaemonStartLock();
  expect(typeof release).toBe('function');
  release?.();
});

test('recovers when a stale-lock reclaimer died before finishing', () => {
  useTempConfigDir();
  const lockPath = join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock');
  writeFileSync(lockPath, JSON.stringify({ pid: 99_999_999, createdAtMs: 0 }));
  const claimPath = reclaimPathFor(lockPath);
  writeFileSync(
    claimPath,
    JSON.stringify({ pid: 99_999_998, createdAtMs: 0, ownerToken: 'dead-reclaimer' }),
  );

  const release = acquireDaemonStartLock();
  expect(typeof release).toBe('function');
  expect(existsSync(claimPath)).toBe(false);
  release?.();
});

test('an old release callback cannot remove a replacement lock', () => {
  useTempConfigDir();
  const path = join(process.env.AGENDEX_CONFIG_DIR as string, 'daemon.start.lock');
  const releaseOld = acquireDaemonStartLock();
  expect(typeof releaseOld).toBe('function');

  unlinkSync(path);
  const releaseReplacement = acquireDaemonStartLock();
  expect(typeof releaseReplacement).toBe('function');

  releaseOld?.();
  expect(acquireDaemonStartLock()).toBeNull();

  releaseReplacement?.();
  const releaseAfterReplacement = acquireDaemonStartLock();
  expect(typeof releaseAfterReplacement).toBe('function');
  releaseAfterReplacement?.();
});

test('only one process can reclaim and acquire the same stale startup lock', async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'agendex pid process race '));
  const configDir = join(tempRoot, '.agendex');
  mkdirSync(configDir, { recursive: true });
  const goPath = join(tempRoot, 'go');
  const releasePath = join(tempRoot, 'release');
  const resultPaths = [join(tempRoot, 'result-a'), join(tempRoot, 'result-b')];
  const fixture = fileURLToPath(new URL('../scripts/pid-lock-contender.ts', import.meta.url));
  writeFileSync(
    join(configDir, 'daemon.start.lock'),
    JSON.stringify({ pid: 99_999_999, createdAtMs: 0 }),
  );

  const contenders = resultPaths.map((resultPath) =>
    Bun.spawn([process.execPath, fixture, configDir, goPath, releasePath, resultPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );
  try {
    writeFileSync(goPath, 'go');

    const readSettledResults = (): string[] | null => {
      const results: string[] = [];
      for (const path of resultPaths) {
        if (!existsSync(path)) return null;
        const value = readFileSync(path, 'utf8');
        // Contenders publish via temp+rename, but still require a known value so a
        // torn/partial observation can never satisfy the barrier.
        if (value !== 'acquired' && value !== 'blocked') return null;
        results.push(value);
      }
      return results;
    };

    const deadline = Date.now() + 5_000;
    let results = readSettledResults();
    while (results === null && Date.now() < deadline) {
      await Bun.sleep(10);
      results = readSettledResults();
    }

    if (results === null) throw new Error('contenders did not publish settled lock results');
    expect(results.toSorted()).toEqual(['acquired', 'blocked']);

    writeFileSync(releasePath, 'release');
    expect(await Promise.all(contenders.map((process) => process.exited))).toEqual([0, 0]);
  } finally {
    writeFileSync(releasePath, 'release');
    for (const contender of contenders) {
      if (contender.exitCode === null) contender.kill();
    }
    await Promise.all(contenders.map((process) => process.exited));
  }
});
