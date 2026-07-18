import { expect, test } from 'bun:test';
import type { AgendexConfig } from '@agendex/shared';
import type { DeviceInfo } from './api.ts';
import { formatDuration, renderStatus } from './status.ts';

const NOW = 1_700_000_000_000;

function config(overrides: Partial<AgendexConfig> = {}): AgendexConfig {
  return {
    configVersion: 3,
    token: 'local-token',
    cloudToken: 'cloud-token',
    convexUrl: 'https://agendex.example',
    siteUrl: 'https://app.agendex.example',
    deviceId: 'local-device',
    enabledAdapters: ['claude-code', 'codex'],
    customPlanDirs: ['/plans/team', '/plans/personal'],
    ...overrides,
  };
}

test('formats durations compactly for status rows', () => {
  expect(formatDuration(15_000)).toBe('15s');
  expect(formatDuration(90_000)).toBe('1m 30s');
  expect(formatDuration(3_900_000)).toBe('1h 5m');
  expect(formatDuration(93_600_000)).toBe('1d 2h');
});

test('renders grouped status with daemon, cloud, and source summaries', () => {
  const devices: DeviceInfo[] = [
    {
      deviceId: 'local-device',
      hostname: 'workstation',
      ipAddress: '10.0.0.4',
      pid: 123,
      startedAtMs: NOW - 90_000,
      lastSeenAt: NOW - 5_000,
    },
    {
      deviceId: 'old-device',
      hostname: 'oldbox',
      ipAddress: null,
      pid: null,
      startedAtMs: null,
      lastSeenAt: NOW - 10_000_000,
    },
  ];

  const output = renderStatus({
    config: config(),
    configPath: '/tmp/agendex/config.json',
    pidInfo: { pid: 123, startedAtMs: NOW - 90_000, hostname: 'workstation', launcher: 'cli' },
    running: true,
    cliVersion: '2.0.0',
    devices,
    now: NOW,
    color: false,
  });

  expect(output).toContain('Agendex status');
  expect(output).toContain('Local:');
  expect(output).toContain('Cloud:');
  expect(output).toContain('Plan sources:');
  expect(output).toContain('✓ running');
  expect(output).toContain('PID 123 • up 1m 30s • host workstation • via CLI');
  expect(output).toContain('✓ 2 devices');
  expect(output).toContain('1 alive • 1 stale');
  expect(output).toContain('workstation (this machine)');
  expect(output).toContain('oldbox');
  expect(output).toContain('! stale');
  expect(output).toContain('✓ 2 enabled');
  expect(output).toContain('claude-code, codex');
  expect(output).toContain('/plans/team');
  expect(output).toContain('agendex cleanup --stale');
});

test('renders desktop spawn origin for Electron-launched daemons', () => {
  const output = renderStatus({
    config: config(),
    configPath: '/tmp/agendex/config.json',
    pidInfo: {
      pid: 456,
      startedAtMs: NOW - 30_000,
      hostname: 'workstation',
      launcher: 'desktop',
      parentPid: 100,
    },
    running: true,
    cliVersion: '2.0.0',
    devices: [],
    now: NOW,
    color: false,
  });

  expect(output).toContain('✓ running');
  expect(output).toContain('PID 456 • up 30s • host workstation • via desktop app');
});

test('renders actionable setup guidance when config is missing', () => {
  const output = renderStatus({
    config: null,
    configPath: '/tmp/agendex/config.json',
    pidInfo: null,
    running: false,
    cliVersion: '2.0.0',
    devices: null,
    now: NOW,
    color: false,
  });

  expect(output).toContain('! not running');
  expect(output).toContain('! missing');
  expect(output).toContain('! not logged in');
  expect(output).toContain('! offline');
  expect(output).toContain('! none enabled');
  expect(output).toContain('agendex start');
  expect(output).toContain('agendex login');
  expect(output).toContain('agendex configure');
  expect(output).toContain('agendex open');
});
