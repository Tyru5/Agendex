import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, saveConfig } from '@agendex/shared';
import { getSiteUrl, logout, startCallbackServer } from './auth.ts';

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

const STATE = 'expected-state-nonce';

async function sendCallback(query: Record<string, string>, siteUrl?: string) {
  const { port, result } = await startCallbackServer({ state: STATE, siteUrl, timeoutMs: 5_000 });
  const settled = result.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error: error as Error }),
  );
  const url = new URL(`http://127.0.0.1:${port}/callback`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const res = await fetch(url);
  await res.text();
  return { status: res.status, outcome: await settled };
}

test('login callback accepts the matching state and a trusted Convex site URL', async () => {
  const { status, outcome } = await sendCallback({
    state: STATE,
    token: 'tok',
    convexUrl: 'https://steady-otter-123.convex.site/extra/path',
  });
  expect(status).toBe(200);
  expect(outcome).toEqual({
    ok: true,
    value: { token: 'tok', convexUrl: 'https://steady-otter-123.convex.site' },
  });
});

async function forgedThenGenuine(forged: Record<string, string>) {
  const { port, result } = await startCallbackServer({ state: STATE, timeoutMs: 5_000 });
  const send = async (query: Record<string, string>) => {
    const url = new URL(`http://127.0.0.1:${port}/callback`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const res = await fetch(url);
    await res.text();
    return res.status;
  };
  const forgedStatus = await send(forged);
  const genuineStatus = await send({
    state: STATE,
    token: 'real',
    convexUrl: 'https://steady-otter-123.convex.site',
  });
  return { forgedStatus, genuineStatus, value: await result };
}

test('login callback rejects a forged request without state and keeps waiting', async () => {
  const outcome = await forgedThenGenuine({
    token: 'tok',
    convexUrl: 'https://attacker.example',
  });
  expect(outcome.forgedStatus).toBe(400);
  expect(outcome.genuineStatus).toBe(200);
  expect(outcome.value).toEqual({
    token: 'real',
    convexUrl: 'https://steady-otter-123.convex.site',
  });
});

test('login callback rejects a wrong state and keeps waiting', async () => {
  const outcome = await forgedThenGenuine({
    state: `${STATE}x`,
    token: 'tok',
    convexUrl: 'https://steady-otter-123.convex.site',
  });
  expect(outcome.forgedStatus).toBe(400);
  expect(outcome.genuineStatus).toBe(200);
  expect(outcome.value.token).toBe('real');
});

test('login callback rejects a disallowed convexUrl', async () => {
  const { status, outcome } = await sendCallback({
    state: STATE,
    token: 'tok',
    convexUrl: 'https://attacker.example',
  });
  expect(status).toBe(400);
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.error.message).toContain('untrusted Convex URL');
});

test('login callback trusts a Convex URL on the chosen site URL origin (self-hosted)', async () => {
  const { status, outcome } = await sendCallback(
    { state: STATE, token: 'tok', convexUrl: 'https://agendex.example.com/convex' },
    'https://agendex.example.com',
  );
  expect(status).toBe(200);
  expect(outcome).toEqual({
    ok: true,
    value: { token: 'tok', convexUrl: 'https://agendex.example.com' },
  });

  const other = await sendCallback(
    { state: STATE, token: 'tok', convexUrl: 'https://attacker.example' },
    'https://agendex.example.com',
  );
  expect(other.status).toBe(400);
});
