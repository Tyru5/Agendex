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
  readDarwinBootIdentities,
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
  // Same-boot overlap still works when both sides use the canonical ticks identity.
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:638123456789012345' },
      {
        currentHostname: 'current-host',
        currentBootIds: ['win32:638123456789012345'],
      },
    ),
  ).toBe(true);
  // Legacy desktop PID files stored registry BootId; the WSL probe includes it
  // alongside ticks so a still-running older daemon stays current.
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:0x12' },
      {
        currentHostname: 'current-host',
        currentBootIds: ['win32:638123456789012345', 'win32:0x12'],
      },
    ),
  ).toBe(true);
  // Ticks are authoritative: a registry collision must not hide a reboot.
  expect(
    isDaemonPidInfoCurrent(
      {
        pid: process.pid,
        hostname: 'current-host',
        bootId: 'win32:638000000000000000',
        bootIds: ['win32:638000000000000000', 'win32:0x12'],
      },
      {
        currentHostname: 'current-host',
        currentBootIds: ['win32:638123456789012345', 'win32:0x12'],
      },
    ),
  ).toBe(false);
  // Legacy registry-only vs ticks-only is inconclusive unless the PID record
  // itself was written after LastBootUpTime (registry probe failed).
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:0x12', startedAtMs: 2_000 },
      {
        currentHostname: 'current-host',
        currentBootIds: ['win32:638123456789012345'],
      },
    ),
  ).toBe(false);
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:0x12', startedAtMs: 500 },
      {
        currentHostname: 'current-host',
        currentBootIds: ['win32:638123456789012345'],
        currentBootTimeMs: 1_000,
      },
    ),
  ).toBe(false);
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:0x12', startedAtMs: 2_000 },
      {
        currentHostname: 'current-host',
        currentBootIds: ['win32:638123456789012345'],
        currentBootTimeMs: 1_000,
      },
    ),
  ).toBe(true);
  expect(
    isDaemonPidInfoCurrent(
      {
        pid: process.pid,
        hostname: 'current-host',
        bootId: 'win32:638000000000000000',
        bootIds: ['win32:638000000000000000'],
      },
      {
        currentHostname: 'current-host',
        currentBootIds: ['win32:638123456789012345'],
      },
    ),
  ).toBe(false);
  expect(
    isDaemonPidInfoCurrent(
      { pid: process.pid, hostname: 'current-host', bootId: 'win32:638123456789012345' },
      { currentHostname: 'current-host', currentBootIds: [] },
    ),
  ).toBe(false);
});

test('macOS boot microsecond drift preserves a live daemon record', () => {
  const bootId = 'darwin:{ sec = 1788278233, usec = 971069 } Tue Sep 1 09:57:13 2026';
  const runtime = {
    currentHostname: 'current-host',
    currentBootIds: ['darwin:{ sec = 1788278233, usec = 900798 } Tue Sep 1 09:57:13 2026'],
    processRunning: true,
    processCommand: '/usr/local/bin/agendex start --daemon',
  };
  for (const metadata of [{ bootId }, { bootIds: [bootId] }, { bootId, bootIds: [bootId] }]) {
    const info = { pid: 123, hostname: 'current-host', launcher: 'cli' as const, ...metadata };
    expect(isDaemonPidInfoCurrent(info, runtime)).toBe(true);
    expect(isDaemonPidInfoRunning(info, runtime)).toBe(true);
    expect(isDaemonPidInfoRunning(info, { ...runtime, processRunning: false })).toBe(false);
    expect(isDaemonPidInfoRunning(info, { ...runtime, processCommand: 'unrelated --daemon' })).toBe(
      false,
    );
    expect(isDaemonPidInfoCurrent(info, { ...runtime, currentHostname: 'other-host' })).toBe(false);
  }
});

test('macOS UUIDs are authoritative over legacy boot timestamps', () => {
  const uuid = 'darwin:bootsessionuuid:4858dfb0-58f3-4a95-9238-dc5553baadf9';
  const otherUuid = 'darwin:bootsessionuuid:5858dfb0-58f3-4a95-9238-dc5553baadf9';
  const legacy = 'darwin:{ sec = 1788278233, usec = 971069 }';
  const drifted = 'darwin:{ sec = 1788278233, usec = 900798 }';
  for (const [stored, current, expected] of [
    [[uuid, legacy], [uuid, 'darwin:{ sec = 1788278000, usec = 0 }'], true],
    [[uuid, legacy], [otherUuid, legacy], false],
    [[uuid], [otherUuid], false],
    [
      [uuid],
      [uuid.toUpperCase().replace('DARWIN:BOOTSESSIONUUID:', 'darwin:bootsessionuuid:')],
      true,
    ],
    [[legacy], [uuid, drifted], true],
    [[uuid, legacy], [drifted], true],
    [[uuid], [legacy], false],
    [[legacy], [uuid], false],
    [['linux:boot-a'], ['linux:boot-a'], true],
    [['linux:boot-a'], ['linux:boot-b'], false],
  ] as const) {
    expect(
      isDaemonPidInfoCurrent(
        { pid: 123, bootId: stored[0], bootIds: [...stored] },
        {
          currentBootIds: [...current],
        },
      ),
    ).toBe(expected);
  }
});

test('macOS legacy boot drift is bounded to one second with validated timestamps', () => {
  const legacy = 'darwin:{ sec = 1788278233, usec = 900798 }';
  for (const [currentBootId, expected] of [
    ['darwin:{ sec = 1788278234, usec = 900798 }', true],
    ['darwin:{ sec = 1788278234, usec = 900799 }', false],
    ['darwin:{ sec = 1788278232, usec = 900798 }', true],
    ['darwin:{ sec = 1788278232, usec = 900797 }', false],
    ['darwin:{ sec = 1788278234, usec = 1 }', true],
    ['darwin: {sec=1788278233,usec=900798} different date formatting', true],
    ['darwin:{ sec = 01788278233, usec = 0900798 }', true],
    ['darwin:{ sec = 1788000000, usec = 900798 }', false],
    ['darwin:{ sec = 1788278233, usec = 1000000 }', false],
    ['darwin:{ sec = 1788278233, usec = -1 }', false],
    ['darwin:{ sec = 1788278233.5, usec = 0 }', false],
    ['darwin:{ sec = -1788278233, usec = 0 }', false],
    ['darwin:{ sec = 1788278233, usec = 900798.0 }', false],
    ['darwin:{ sec = 1788278233 }', false],
    ['darwin:{ usec = 900798 }', false],
    ['darwin:{ sec = 99999999999999999, usec = 0 }', false],
    ['darwin:bootsessionuuid:invalid', false],
    ['darwin:garbage', false],
    [null, false],
  ] as const) {
    expect(isDaemonPidInfoCurrent({ pid: 123, bootId: legacy }, { currentBootId })).toBe(expected);
  }
  for (const bootId of [
    'darwin:garbage',
    'darwin:bootsessionuuid:invalid',
    'darwin:{ sec = 1, usec = 1000000 }',
  ]) {
    expect(isDaemonPidInfoCurrent({ pid: 123, bootId }, { currentBootId: bootId })).toBe(false);
  }
});

test('macOS boot probes collect validated identities independently and prefer UUIDs', () => {
  const uuid = '4858DFB0-58F3-4A95-9238-DC5553BAADF9';
  const legacy = '{ sec = 1788278233, usec = 900798 }';
  const uuidId = `darwin:bootsessionuuid:${uuid.toLowerCase()}`;
  for (const [uuidResult, timeResult, expected] of [
    [uuid, legacy, [uuidId, `darwin:${legacy}`]],
    [null, legacy, [`darwin:${legacy}`]],
    [uuid, null, [uuidId]],
    ['invalid', legacy, [`darwin:${legacy}`]],
    [uuid, 'invalid', [uuidId]],
    [uuid, '{ sec = 1788278233, usec = 1000000 }', [uuidId]],
    ['', '', []],
    [null, null, []],
  ] as const) {
    const calls: string[] = [];
    expect(
      readDarwinBootIdentities({
        readSysctl: (name) => {
          calls.push(name);
          const value = name === 'kern.bootsessionuuid' ? uuidResult : timeResult;
          if (value === null) throw new Error('sysctl unavailable');
          return ` ${value}\n`;
        },
      }),
    ).toEqual([...expected]);
    expect(calls).toEqual(['kern.bootsessionuuid', 'kern.boottime']);
  }
});

test('missing macOS boot evidence cannot use the Windows timestamp fallback', () => {
  for (const bootId of [
    'darwin:{ sec = 1788278233, usec = 900798 }',
    'darwin:bootsessionuuid:4858dfb0-58f3-4a95-9238-dc5553baadf9',
    'darwin:garbage',
  ]) {
    expect(
      isDaemonPidInfoCurrent(
        { pid: 123, bootId, startedAtMs: 2_000 },
        { currentBootId: null, currentBootTimeMs: 1_000 },
      ),
    ).toBe(false);
  }
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
    bootId: 'win32:638123456789012345',
  };
  const probe = JSON.stringify({
    selectedEnv: 'wsl',
    pidInfo,
    currentHostname: 'windows-host',
    currentBootId: 'win32:638123456789012345',
    currentBootIds: ['win32:638123456789012345', 'win32:0x12'],
    processRunning: true,
    processCommand: 'Agendex.exe --type=utility --utility-sub-type=node.mojom.NodeService',
    parentProcessRunning: true,
    currentBootTimeMs: 1_699_000_000_000,
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

  expect(
    readWindowsDesktopDaemonInfoFromWsl({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      runProbe: () => {
        const { bootId: _bootId, ...pidInfoWithoutBoot } = pidInfo;
        return JSON.stringify({
          ...JSON.parse(probe),
          pidInfo: pidInfoWithoutBoot,
        });
      },
    }),
  ).toBeNull();

  const legacyPidInfo = { ...pidInfo, bootId: 'win32:0x12' };
  expect(
    readWindowsDesktopDaemonInfoFromWsl({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      runProbe: () =>
        JSON.stringify({
          ...JSON.parse(probe),
          pidInfo: legacyPidInfo,
        }),
    }),
  ).toEqual(legacyPidInfo);
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
