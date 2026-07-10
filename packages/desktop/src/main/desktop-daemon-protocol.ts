export interface DesktopDaemonCredentials {
  token: string;
  convexSiteUrl: string;
  accountId?: string;
}

export type DesktopDaemonParentMessage =
  | {
      type: 'start';
      credentials: DesktopDaemonCredentials;
      parentPid: number;
    }
  | { type: 'credentials-updated'; credentials: DesktopDaemonCredentials }
  | { type: 'shutdown' };

export type DesktopDaemonWorkerMessage =
  | { type: 'ready'; pid: number }
  | { type: 'token-rotated'; previousToken: string; token: string; accountId?: string }
  | { type: 'auth-expired'; failedToken: string }
  | { type: 'fatal'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseCredentials(value: unknown): DesktopDaemonCredentials | null {
  if (!isRecord(value)) return null;
  const { token, convexSiteUrl } = value;
  if (typeof token !== 'string' || !token.trim()) return null;
  if (typeof convexSiteUrl !== 'string' || !convexSiteUrl.trim()) return null;
  const accountId = typeof value.accountId === 'string' ? value.accountId.trim() : '';
  return { token, convexSiteUrl, ...(accountId ? { accountId } : {}) };
}

export function parseDesktopDaemonParentMessage(value: unknown): DesktopDaemonParentMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'shutdown') return { type: 'shutdown' };

  const credentials = parseCredentials(value.credentials);
  if (!credentials) return null;
  if (value.type === 'credentials-updated') {
    return { type: 'credentials-updated', credentials };
  }
  if (value.type !== 'start' || typeof value.parentPid !== 'number' || value.parentPid <= 0) {
    return null;
  }
  return { type: 'start', credentials, parentPid: value.parentPid };
}

export function parseDesktopDaemonWorkerMessage(value: unknown): DesktopDaemonWorkerMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'auth-expired' && typeof value.failedToken === 'string' && value.failedToken) {
    return { type: 'auth-expired', failedToken: value.failedToken };
  }
  if (value.type === 'ready' && typeof value.pid === 'number' && value.pid > 0) {
    return { type: 'ready', pid: value.pid };
  }
  if (
    value.type === 'token-rotated' &&
    typeof value.previousToken === 'string' &&
    typeof value.token === 'string' &&
    value.previousToken &&
    value.token
  ) {
    const accountId = typeof value.accountId === 'string' ? value.accountId.trim() : '';
    return {
      type: 'token-rotated',
      previousToken: value.previousToken,
      token: value.token,
      ...(accountId ? { accountId } : {}),
    };
  }
  if (value.type === 'fatal' && typeof value.message === 'string') {
    return { type: 'fatal', message: value.message };
  }
  return null;
}
