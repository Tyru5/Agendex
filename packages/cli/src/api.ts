import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostname as osHostname } from 'node:os';
import { loadConfig, loadOrCreateDeviceId, saveConfig } from '@agendex/shared';
import { readPidInfo } from './pid.ts';

let cachedDeviceId: string | undefined;

function getCloudConfig() {
  const config = loadConfig();
  if (!config?.cloudToken) throw new Error('Not logged in. Run `agendex login` first.');
  if (!config.convexUrl) throw new Error('No Convex URL configured. Run `agendex login` first.');
  return { token: config.cloudToken, convexUrl: config.convexUrl };
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

export async function syncPlan(plan: SyncPlanPayload): Promise<{ ok: boolean; error?: string }> {
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

  return { ok: true };
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
    const heartbeatBody = JSON.stringify({
      deviceId: (cachedDeviceId ??= loadOrCreateDeviceId()),
      hostname: pidInfo?.hostname ?? osHostname(),
      startedAtMs: pidInfo?.startedAtMs,
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

  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        headers: options.headers,
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
