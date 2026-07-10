import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, saveConfig } from '@agendex/shared';
import { getSiteUrl, logout } from './auth.ts';

let dir: string;
let prevConfigDir: string | undefined;
let prevSiteUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agendex-auth-'));
  prevConfigDir = process.env.AGENDEX_CONFIG_DIR;
  prevSiteUrl = process.env.AGENDEX_SITE_URL;
  process.env.AGENDEX_CONFIG_DIR = join(dir, 'config');
  delete process.env.AGENDEX_SITE_URL;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = prevConfigDir;
  if (prevSiteUrl === undefined) delete process.env.AGENDEX_SITE_URL;
  else process.env.AGENDEX_SITE_URL = prevSiteUrl;
  rmSync(dir, { recursive: true, force: true });
});

test('logout preserves stored siteUrl for subsequent open/upload URLs', () => {
  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
    cloudToken: 'tok',
    cloudAccountId: 'account-1',
    convexUrl: 'https://example.convex.cloud',
    siteUrl: 'https://self-hosted.example.com',
  });

  logout();

  const config = loadConfig();
  expect(config?.cloudToken).toBeUndefined();
  expect(config?.cloudAccountId).toBeUndefined();
  expect(config?.siteUrl).toBe('https://self-hosted.example.com');
  expect(getSiteUrl()).toBe('https://self-hosted.example.com');
});
