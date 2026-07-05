import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP_AUTH_CALLBACK_URL } from '@agendex/shared/desktop-auth-callback';
import { app, shell } from 'electron';
import {
  buildDesktopAuthUrl,
  parseDesktopAuthProvider,
  type DesktopAuthProvider,
} from './cloud-login-url.ts';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const PENDING_LOGIN_FILE = 'agendex-desktop-auth-pending.json';

export type PendingDesktopAuthLogin = {
  readonly state: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly provider: DesktopAuthProvider;
  readonly callbackUrl: typeof DESKTOP_AUTH_CALLBACK_URL;
};

export type CompletePendingDesktopAuthLoginResult =
  | { readonly ok: true; readonly pending: PendingDesktopAuthLogin }
  | {
      readonly ok: false;
      readonly reason:
        | 'missing-pending-login'
        | 'state-mismatch'
        | 'state-expired'
        | 'malformed-pending-login';
    };

type DesktopAuthTimeoutHandle = {
  readonly unref?: () => void;
};

type StartDesktopAuthLoginOptions = {
  readonly nowMs?: () => number;
  readonly scheduleTimeout?: (callback: () => void, delayMs: number) => DesktopAuthTimeoutHandle;
};

export class DesktopAuthLoginError extends Error {
  readonly code: 'active-attempt' | 'unsupported-provider';

  constructor(code: 'active-attempt' | 'unsupported-provider', message: string) {
    super(message);
    this.name = 'DesktopAuthLoginError';
    this.code = code;
  }
}

function pendingLoginPath(): string {
  return join(app.getPath('userData'), PENDING_LOGIN_FILE);
}

function resolveDesktopProvider(provider: unknown): DesktopAuthProvider {
  const parsed = parseDesktopAuthProvider(provider);
  if (parsed === null) {
    throw new DesktopAuthLoginError('unsupported-provider', 'Unsupported desktop auth provider');
  }
  return parsed ?? 'github';
}

function createState(): string {
  return randomBytes(32).toString('base64url');
}

function parsePendingDesktopAuthLogin(value: unknown): PendingDesktopAuthLogin | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const state = Reflect.get(value, 'state');
  const createdAtMs = Reflect.get(value, 'createdAtMs');
  const expiresAtMs = Reflect.get(value, 'expiresAtMs');
  const provider = Reflect.get(value, 'provider');
  const callbackUrl = Reflect.get(value, 'callbackUrl');

  if (typeof state !== 'string' || state.trim().length === 0) return null;
  if (typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs)) return null;
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) return null;
  if (provider !== 'github' && provider !== 'google') return null;
  if (callbackUrl !== DESKTOP_AUTH_CALLBACK_URL) return null;

  return {
    state,
    createdAtMs,
    expiresAtMs,
    provider,
    callbackUrl,
  };
}

function savePendingDesktopAuthLogin(pending: PendingDesktopAuthLogin): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(pendingLoginPath(), JSON.stringify(pending), 'utf8');
}

function clearPendingDesktopAuthLoginForState(state: string): void {
  const pending = loadPendingDesktopAuthLogin();
  if (!pending || pending.state !== state) return;
  clearPendingDesktopAuthLogin();
}

export function createPendingDesktopAuthLogin(
  provider: DesktopAuthProvider,
  nowMs = Date.now(),
): PendingDesktopAuthLogin {
  return {
    state: createState(),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + LOGIN_TIMEOUT_MS,
    provider,
    callbackUrl: DESKTOP_AUTH_CALLBACK_URL,
  };
}

export function loadPendingDesktopAuthLogin(nowMs = Date.now()): PendingDesktopAuthLogin | null {
  try {
    const path = pendingLoginPath();
    if (!existsSync(path)) return null;

    const parsed = parsePendingDesktopAuthLogin(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed) {
      clearPendingDesktopAuthLogin();
      return null;
    }

    if (nowMs >= parsed.expiresAtMs) {
      clearPendingDesktopAuthLogin();
      return null;
    }

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      clearPendingDesktopAuthLogin();
      return null;
    }
    throw err;
  }
}

export function clearPendingDesktopAuthLogin(): void {
  const path = pendingLoginPath();
  if (existsSync(path)) rmSync(path);
}

export function completePendingDesktopAuthLogin(
  state: string,
  nowMs = Date.now(),
): CompletePendingDesktopAuthLoginResult {
  let pending: PendingDesktopAuthLogin | null;
  try {
    const path = pendingLoginPath();
    if (!existsSync(path)) return { ok: false, reason: 'missing-pending-login' };
    pending = parsePendingDesktopAuthLogin(JSON.parse(readFileSync(path, 'utf8')));
    if (!pending) {
      clearPendingDesktopAuthLogin();
      return { ok: false, reason: 'malformed-pending-login' };
    }
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    clearPendingDesktopAuthLogin();
    return { ok: false, reason: 'malformed-pending-login' };
  }

  if (nowMs >= pending.expiresAtMs) {
    clearPendingDesktopAuthLogin();
    return { ok: false, reason: 'state-expired' };
  }

  if (pending.state !== state) return { ok: false, reason: 'state-mismatch' };

  clearPendingDesktopAuthLogin();
  return { ok: true, pending };
}

export async function startDesktopAuthLogin(
  siteUrl: string,
  provider?: DesktopAuthProvider,
  options: StartDesktopAuthLoginOptions = {},
): Promise<PendingDesktopAuthLogin> {
  const resolvedProvider = resolveDesktopProvider(provider);
  const nowMs = options.nowMs?.() ?? Date.now();
  const activePending = loadPendingDesktopAuthLogin(nowMs);
  if (activePending) {
    throw new DesktopAuthLoginError('active-attempt', 'A desktop auth attempt is already active');
  }

  const pending = createPendingDesktopAuthLogin(resolvedProvider, nowMs);
  savePendingDesktopAuthLogin(pending);

  try {
    const authUrl = buildDesktopAuthUrl(siteUrl, pending.state, pending.provider);
    await shell.openExternal(authUrl);
    const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
    const timeout = scheduleTimeout(
      () => clearPendingDesktopAuthLoginForState(pending.state),
      pending.expiresAtMs - nowMs,
    );
    timeout.unref?.();
    return pending;
  } catch (err) {
    clearPendingDesktopAuthLoginForState(pending.state);
    throw err;
  }
}
