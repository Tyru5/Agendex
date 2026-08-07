export type DesktopBackendParentMessage =
  | {
      type: 'start';
      port: number;
      hostname: string;
      clientDistDir: string;
      parentPid: number;
    }
  | { type: 'set-client-dist-dir'; clientDistDir: string }
  | { type: 'shutdown' };

export type DesktopBackendWorkerMessage =
  | { type: 'listening'; port: number; token: string }
  | { type: 'index-ready' }
  | { type: 'fatal'; phase: 'startup' | 'indexing'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseDesktopBackendParentMessage(
  value: unknown,
): DesktopBackendParentMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'shutdown') return { type: 'shutdown' };
  if (value.type === 'set-client-dist-dir') {
    return typeof value.clientDistDir === 'string' && value.clientDistDir
      ? { type: 'set-client-dist-dir', clientDistDir: value.clientDistDir }
      : null;
  }
  if (
    value.type !== 'start' ||
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 0 ||
    typeof value.hostname !== 'string' ||
    !value.hostname ||
    typeof value.clientDistDir !== 'string' ||
    !value.clientDistDir ||
    typeof value.parentPid !== 'number' ||
    !Number.isInteger(value.parentPid) ||
    value.parentPid <= 0
  ) {
    return null;
  }
  return {
    type: 'start',
    port: value.port,
    hostname: value.hostname,
    clientDistDir: value.clientDistDir,
    parentPid: value.parentPid,
  };
}

export function parseDesktopBackendWorkerMessage(
  value: unknown,
): DesktopBackendWorkerMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'index-ready') return { type: 'index-ready' };
  if (
    value.type === 'listening' &&
    typeof value.port === 'number' &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    typeof value.token === 'string' &&
    value.token
  ) {
    return { type: 'listening', port: value.port, token: value.token };
  }
  if (
    value.type === 'fatal' &&
    (value.phase === 'startup' || value.phase === 'indexing') &&
    typeof value.message === 'string' &&
    value.message
  ) {
    return { type: 'fatal', phase: value.phase, message: value.message };
  }
  return null;
}
