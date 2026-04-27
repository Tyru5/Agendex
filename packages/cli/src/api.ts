import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostname as osHostname } from 'node:os';
import { loadConfig, loadOrCreateDeviceId, saveConfig } from '@agendex/shared';
import { readPidInfo } from './pid.ts';

export class AuthExpiredError extends Error {
  constructor() {
    super('Cloud token expired. Run `agendex login` to re-authenticate.');
    this.name = 'AuthExpiredError';
  }
}

let cachedDeviceId: string | undefined;

function getCloudConfig() {
  const config = loadConfig();

  if (!config?.cloudToken) throw new Error('Not logged in. Run `agendex login` first.');
  if (!config.convexUrl) throw new Error('No Convex URL configured. Run `agendex login` first.');

  return {
    token: config.cloudToken,
    convexUrl: config.convexUrl,
  };
}

export interface SyncPlanPayload {
  localPlanId: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath?: string;
  workspace?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export interface SyncPlanResult {
  ok: boolean;
  error?: string;
  skippedLowValue?: boolean;
  deleted?: boolean;
}

function parseSyncSuccess(body: string): SyncPlanResult {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: true };
    }
    const result = parsed as Record<string, unknown>;
    return {
      ok: true,
      skippedLowValue: result.skippedLowValue === true,
      deleted: result.deleted === true,
    };
  } catch {
    return { ok: true };
  }
}

export async function syncPlan(plan: SyncPlanPayload): Promise<SyncPlanResult> {
  const { token, convexUrl } = getCloudConfig();
  const url = `${convexUrl}/api/cli/sync`;
  let activeToken = token;

  let res = await requestText(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${activeToken}`,
      Connection: 'close',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(plan),
  });

  if (res.status === 401) {
    const refreshed = await refreshStoredToken(activeToken, convexUrl);
    if (refreshed) {
      activeToken = refreshed;
      res = await requestText(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Connection: 'close',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(plan),
      });
    }
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: `${res.status}: ${res.body}` };
  }

  return parseSyncSuccess(res.body);
}

async function refreshStoredToken(currentToken: string, convexUrl: string): Promise<string | null> {
  const refreshed = await refreshToken(currentToken, convexUrl);
  if (!refreshed) return null;

  const config = loadConfig();
  if (config) {
    saveConfig({ ...config, cloudToken: refreshed.token });
  }

  return refreshed.token;
}

export async function sendHeartbeat(): Promise<void> {
  try {
    const { token, convexUrl } = getCloudConfig();
    const pidInfo = readPidInfo();
    cachedDeviceId ??= loadOrCreateDeviceId();
    const heartbeatBody = JSON.stringify({
      deviceId: cachedDeviceId,
      hostname: pidInfo?.hostname ?? osHostname(),
      startedAtMs: pidInfo?.startedAtMs,
      pid: pidInfo?.pid,
    });
    let activeToken = token;
    let res = await requestText(`${convexUrl}/api/cli/heartbeat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeToken}`,
        Connection: 'close',
        'Content-Type': 'application/json',
      },
      body: heartbeatBody,
    });

    if (res.status === 401) {
      const refreshedToken = await refreshStoredToken(activeToken, convexUrl);
      if (!refreshedToken) return;

      activeToken = refreshedToken;
      res = await requestText(`${convexUrl}/api/cli/heartbeat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Connection: 'close',
          'Content-Type': 'application/json',
        },
        body: heartbeatBody,
      });
    }

    if (res.status === 401) {
      return;
    }
  } catch {
    // best-effort, don't crash the daemon
  }
}

export async function sendShutdown(): Promise<void> {
  try {
    cachedDeviceId ??= loadOrCreateDeviceId();
    await deleteDaemons([cachedDeviceId]);
  } catch {
    // best-effort — don't prevent shutdown
  }
}

export async function refreshToken(
  currentToken: string,
  convexUrl: string,
): Promise<{ token: string; expiresAt: number } | null> {
  const res = await requestText(`${convexUrl}/api/cli/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${currentToken}`,
      Connection: 'close',
      'Content-Type': 'application/json',
    },
  });

  if (res.status < 200 || res.status >= 300) return null;

  const body = JSON.parse(res.body) as { token?: string; expiresAt?: number };
  if (!body.token) return null;
  return { token: body.token, expiresAt: body.expiresAt ?? 0 };
}

interface RequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

interface TextResponse {
  status: number;
  body: string;
}

function requestText(urlString: string, options: RequestOptions): Promise<TextResponse> {
  const url = new URL(urlString);

  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers: Record<string, string> = { ...options.headers };

  if (options.body) {
    headers['Content-Length'] = String(Buffer.byteLength(options.body));
  }

  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        headers,
        method: options.method,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body,
          });
        });
        res.on('error', reject);
      },
    );

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

export interface DeviceInfo {
  deviceId: string | null;
  hostname: string | null;
  pid: number | null;
  startedAtMs: number | null;
  lastSeenAt: number | null;
}

export async function fetchDevices(): Promise<DeviceInfo[]> {
  const { token, convexUrl } = getCloudConfig();

  const url = `${convexUrl}/api/cli/devices`;
  let activeToken = token;

  let res = await requestText(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${activeToken}`,
      Connection: 'close',
    },
  });

  if (res.status === 401) {
    const refreshed = await refreshStoredToken(activeToken, convexUrl);
    if (refreshed) {
      activeToken = refreshed;
      res = await requestText(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Connection: 'close',
        },
      });
    }
  }

  if (res.status === 401) {
    throw new AuthExpiredError();
  }

  if (res.status < 200 || res.status >= 300) {
    return [];
  }

  const body = JSON.parse(res.body) as { devices?: DeviceInfo[] };
  return body.devices ?? [];
}

export async function deleteDaemons(
  deviceIds: string[],
): Promise<{ ok: boolean; deleted: number }> {
  const { token, convexUrl } = getCloudConfig();
  const url = `${convexUrl}/api/cli/devices`;
  let activeToken = token;

  let res = await requestText(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${activeToken}`,
      Connection: 'close',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deviceIds }),
  });

  if (res.status === 401) {
    const refreshed = await refreshStoredToken(activeToken, convexUrl);
    if (refreshed) {
      activeToken = refreshed;
      res = await requestText(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Connection: 'close',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceIds }),
      });
    }
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, deleted: 0 };
  }

  const body = JSON.parse(res.body) as { ok?: boolean; deleted?: number };
  return { ok: body.ok ?? false, deleted: body.deleted ?? 0 };
}
