import {
  parseDesktopAuthCallbackUrl,
  redactDesktopAuthCallbackUrl,
} from '@agendex/shared/desktop-auth-callback';
import type { CloudCreds } from './cloud-auth.ts';
import type {
  CompletePendingDesktopAuthLoginResult,
  PendingDesktopAuthLogin,
} from './cloud-login.ts';

const DESKTOP_AUTH_PROTOCOL = 'agendex';
const DESKTOP_AUTH_PROTOCOL_WITH_COLON = `${DESKTOP_AUTH_PROTOCOL}:`;
const DESKTOP_AUTH_HOST = 'auth';
const DESKTOP_AUTH_PATH = '/callback';

export type DesktopProtocolWindowState = {
  readonly hasWindow: boolean;
  readonly isDestroyed: boolean;
};

type DesktopProtocolTimeoutHandle = {
  readonly unref?: () => void;
};

export type DesktopProtocolControllerDeps = {
  readonly loadPendingLogin: (nowMs?: number) => PendingDesktopAuthLogin | null;
  readonly completePendingLogin: (
    state: string,
    nowMs?: number,
  ) => CompletePendingDesktopAuthLoginResult;
  readonly validateCloudCreds: (creds: CloudCreds) => Promise<CloudCreds | null>;
  readonly saveCloudCreds: (creds: CloudCreds) => void;
  readonly getWindowState: () => DesktopProtocolWindowState;
  readonly reloadDashboardWindow: () => void;
  readonly focusDashboardWindow: () => void;
  readonly createDashboardWindow: () => void;
  readonly log: (message: string) => void;
  readonly nowMs?: () => number;
  readonly scheduleTimeout?: (
    callback: () => void,
    delayMs: number,
  ) => DesktopProtocolTimeoutHandle;
};

export type DesktopProtocolController = {
  readonly createPendingLoginCompletion: (state: string, expiresAtMs?: number) => Promise<boolean>;
  readonly enqueueProtocolUrl: (value: string) => boolean;
  readonly handleCommandLine: (argv: readonly string[]) => boolean;
  readonly drainQueuedCallbacks: () => Promise<void>;
  readonly completeProtocolCallback: (value: string) => Promise<boolean>;
};

export type DesktopProtocolRegistration = {
  readonly isDefaultApp: boolean;
  readonly execPath: string;
  readonly argv: readonly string[];
  readonly setAsDefaultProtocolClient: (
    protocol: string,
    execPath?: string,
    args?: string[],
  ) => boolean;
};

type PendingLoginCompletion = {
  readonly state: string;
  readonly resolve: (value: boolean) => void;
};

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
}

function isDesktopAuthCallbackUrl(value: string): boolean {
  const parsed = parseUrl(value);
  return Boolean(
    parsed &&
    parsed.protocol === DESKTOP_AUTH_PROTOCOL_WITH_COLON &&
    parsed.hostname === DESKTOP_AUTH_HOST &&
    parsed.pathname === DESKTOP_AUTH_PATH,
  );
}

function readDesktopAuthCallbackState(value: string): string | null {
  const parsed = parseUrl(value);
  if (
    !parsed ||
    parsed.protocol !== DESKTOP_AUTH_PROTOCOL_WITH_COLON ||
    parsed.hostname !== DESKTOP_AUTH_HOST ||
    parsed.pathname !== DESKTOP_AUTH_PATH
  ) {
    return null;
  }
  const state = parsed.searchParams.get('state');
  return state && state.trim().length > 0 ? state : null;
}

export function extractDesktopAuthCallbackUrl(argv: readonly string[]): string | null {
  return argv.find(isDesktopAuthCallbackUrl) ?? null;
}

export function registerDesktopProtocolClient(registration: DesktopProtocolRegistration): boolean {
  if (!registration.isDefaultApp) {
    return registration.setAsDefaultProtocolClient(DESKTOP_AUTH_PROTOCOL);
  }

  const devArgs = registration.argv.slice(1);
  return registration.setAsDefaultProtocolClient(
    DESKTOP_AUTH_PROTOCOL,
    registration.execPath,
    devArgs,
  );
}

export function createDesktopProtocolController(
  deps: DesktopProtocolControllerDeps,
): DesktopProtocolController {
  const queuedCallbacks: string[] = [];
  let pendingCompletion: PendingLoginCompletion | null = null;

  function nowMs(): number {
    return deps.nowMs?.() ?? Date.now();
  }

  function redact(value: string): string {
    return redactDesktopAuthCallbackUrl(value);
  }

  function logRejected(rawUrl: string, reason: string): void {
    deps.log(`rejected ${redact(rawUrl)} reason=${reason}`);
  }

  function resolvePendingCompletion(state: string, value: boolean): boolean {
    if (!pendingCompletion || pendingCompletion.state !== state) return false;
    const completion = pendingCompletion;
    pendingCompletion = null;
    completion.resolve(value);
    return true;
  }

  function navigateAfterExternalCallback(): void {
    const windowState = deps.getWindowState();
    if (!windowState.hasWindow || windowState.isDestroyed) {
      deps.createDashboardWindow();
      return;
    }
    deps.reloadDashboardWindow();
    deps.focusDashboardWindow();
  }

  async function completeProtocolCallback(rawUrl: string): Promise<boolean> {
    const pending = deps.loadPendingLogin(nowMs());
    if (!pending) {
      logRejected(rawUrl, 'missing-pending-login');
      return false;
    }

    const receivedState = readDesktopAuthCallbackState(rawUrl);
    if (!receivedState) {
      logRejected(rawUrl, 'missing-state');
      return false;
    }
    if (receivedState !== pending.state) {
      logRejected(rawUrl, 'state-mismatch');
      return false;
    }

    const completed = deps.completePendingLogin(receivedState, nowMs());
    if (!completed.ok) {
      logRejected(rawUrl, completed.reason);
      if (
        completed.reason === 'missing-pending-login' ||
        completed.reason === 'state-expired' ||
        completed.reason === 'malformed-pending-login'
      ) {
        resolvePendingCompletion(receivedState, false);
      }
      return false;
    }

    const parsed = parseDesktopAuthCallbackUrl(rawUrl, {
      state: completed.pending.state,
      expiresAtMs: completed.pending.expiresAtMs,
      nowMs: nowMs(),
    });
    if (!parsed.ok) {
      logRejected(rawUrl, parsed.error.code);
      resolvePendingCompletion(completed.pending.state, false);
      return false;
    }

    const validatedCreds = await deps.validateCloudCreds({
      token: parsed.value.token,
      convexSiteUrl: parsed.value.convexUrl,
    });
    if (!validatedCreds) {
      logRejected(rawUrl, 'cloud-validation-failed');
      resolvePendingCompletion(completed.pending.state, false);
      return false;
    }

    deps.saveCloudCreds(validatedCreds);
    const resolvedIpc = resolvePendingCompletion(completed.pending.state, true);
    if (!resolvedIpc) navigateAfterExternalCallback();
    return true;
  }

  async function drainQueuedCallbacks(): Promise<void> {
    while (queuedCallbacks.length > 0) {
      const rawUrl = queuedCallbacks.shift();
      if (rawUrl) await completeProtocolCallback(rawUrl);
    }
  }

  return {
    createPendingLoginCompletion: (state: string, expiresAtMs?: number): Promise<boolean> =>
      new Promise((resolve) => {
        if (pendingCompletion) pendingCompletion.resolve(false);
        pendingCompletion = { state, resolve };
        // The pending-login file expires on its own, but nothing else settles
        // this promise, so the renderer would await `agendex:login` forever
        // ("Waiting…" with disabled buttons). Resolve false at expiry so the
        // sign-in UI can surface an error and let the user retry.
        if (typeof expiresAtMs !== 'number') return;
        const delayMs = Math.max(0, expiresAtMs - nowMs());
        const scheduleTimeout = deps.scheduleTimeout ?? setTimeout;
        const timeout = scheduleTimeout(() => resolvePendingCompletion(state, false), delayMs);
        timeout.unref?.();
      }),
    enqueueProtocolUrl: (value: string): boolean => {
      if (!isDesktopAuthCallbackUrl(value)) return false;
      queuedCallbacks.push(value);
      return true;
    },
    handleCommandLine: (argv: readonly string[]): boolean => {
      const rawUrl = extractDesktopAuthCallbackUrl(argv);
      return rawUrl ? queuedCallbacks.push(rawUrl) > 0 : false;
    },
    drainQueuedCallbacks,
    completeProtocolCallback,
  };
}
