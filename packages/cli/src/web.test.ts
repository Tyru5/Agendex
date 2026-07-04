import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveConfig } from '@agendex/shared';
import { openAgendexWeb } from './web.ts';

let dir: string;
let prevConfigDir: string | undefined;
let prevSiteUrl: string | undefined;
let prevDisableBrowser: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agendex-web-'));
  prevConfigDir = process.env.AGENDEX_CONFIG_DIR;
  prevSiteUrl = process.env.AGENDEX_SITE_URL;
  prevDisableBrowser = process.env.AGENDEX_DISABLE_BROWSER;
  process.env.AGENDEX_CONFIG_DIR = join(dir, 'config');
  process.env.AGENDEX_DISABLE_BROWSER = '1';
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = prevConfigDir;
  if (prevSiteUrl === undefined) delete process.env.AGENDEX_SITE_URL;
  else process.env.AGENDEX_SITE_URL = prevSiteUrl;
  if (prevDisableBrowser === undefined) delete process.env.AGENDEX_DISABLE_BROWSER;
  else process.env.AGENDEX_DISABLE_BROWSER = prevDisableBrowser;
  rmSync(dir, { recursive: true, force: true });
});

test('open uses stored login site URL when no override is provided', async () => {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    convexUrl: 'https://example.convex.cloud',
    siteUrl: 'https://self-hosted.example.com',
  });
  delete process.env.AGENDEX_SITE_URL;

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    if (typeof message === 'string') logs.push(message);
  };
  try {
    await openAgendexWeb();
  } finally {
    console.log = originalLog;
  }

  expect(logs.some((line) => line.includes('https://self-hosted.example.com/dashboard'))).toBe(
    true,
  );
});

test('open prefers stored login site URL over AGENDEX_SITE_URL', async () => {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    convexUrl: 'https://example.convex.cloud',
    siteUrl: 'https://self-hosted.example.com',
  });
  process.env.AGENDEX_SITE_URL = 'https://app.agendex.dev';

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    if (typeof message === 'string') logs.push(message);
  };
  try {
    await openAgendexWeb();
  } finally {
    console.log = originalLog;
  }

  expect(logs.some((line) => line.includes('https://self-hosted.example.com/dashboard'))).toBe(
    true,
  );
  expect(logs.some((line) => line.includes('https://app.agendex.dev'))).toBe(false);
});

async function captureOpenLogs(): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    if (typeof message === 'string') logs.push(message);
  };
  try {
    await openAgendexWeb();
  } finally {
    console.log = originalLog;
  }
  return logs;
}

test('open targets the authed dashboard, not the landing page (prod default)', async () => {
  delete process.env.AGENDEX_SITE_URL;

  const logs = await captureOpenLogs();

  expect(logs.some((line) => line.includes('https://app.agendex.dev/dashboard'))).toBe(true);
});

test('open targets the authed dashboard, not the landing page (dev default)', async () => {
  delete process.env.AGENDEX_SITE_URL;
  const prevDev = process.env.AGENDEX_DEV;
  process.env.AGENDEX_DEV = '1';
  try {
    const logs = await captureOpenLogs();
    expect(logs.some((line) => line.includes('http://app.agendex.localhost:5174/dashboard'))).toBe(
      true,
    );
  } finally {
    if (prevDev === undefined) delete process.env.AGENDEX_DEV;
    else process.env.AGENDEX_DEV = prevDev;
  }
});

test('open appends /dashboard to a stored site URL with a trailing slash', async () => {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    convexUrl: 'https://example.convex.cloud',
    siteUrl: 'https://self-hosted.example.com/',
  });
  delete process.env.AGENDEX_SITE_URL;

  const logs = await captureOpenLogs();

  expect(logs.some((line) => line.includes('https://self-hosted.example.com/dashboard'))).toBe(
    true,
  );
});
