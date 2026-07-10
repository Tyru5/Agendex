import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostname as osHostname } from 'node:os';
import {
  loadConfig,
  loadOrCreateDeviceId,
  type PlannotatorFeedbackAnnotation,
  type PlannotatorWritebackAction,
  saveConfig,
} from '@agendex/shared';
import { readPidInfo } from './pid.ts';

export class AuthExpiredError extends Error {
  constructor() {
    super('Cloud token expired. Run `agendex login` to re-authenticate.');
    this.name = 'AuthExpiredError';
  }
}

let cachedDeviceId: string | undefined;

export interface DaemonCloudCredentials {
  token: string;
  convexUrl: string;
}

export interface DaemonCredentialStore {
  load: () => DaemonCloudCredentials | null;
  saveToken: (currentToken: string, nextToken: string) => void;
  onAuthExpired?: () => void;
}

const configCredentialStore: DaemonCredentialStore = {
  load: () => {
    const config = loadConfig();
    if (!config?.cloudToken || !config.convexUrl) return null;
    return { token: config.cloudToken, convexUrl: config.convexUrl };
  },
  saveToken: (currentToken, nextToken) => {
    const config = loadConfig();
    if (!config || config.cloudToken !== currentToken) return;
    saveConfig({ ...config, cloudToken: nextToken });
  },
};

let credentialStore: DaemonCredentialStore = configCredentialStore;

export function setDaemonCredentialStore(store: DaemonCredentialStore): void {
  credentialStore = store;
}

export function resetDaemonCredentialStore(): void {
  credentialStore = configCredentialStore;
}

export function hasDaemonCloudCredentials(): boolean {
  return credentialStore.load() !== null;
}

function getCloudConfig(): DaemonCloudCredentials {
  const config = credentialStore.load();

  if (!config?.token) throw new Error('Not logged in. Run `agendex login` first.');
  if (!config.convexUrl) throw new Error('No Convex URL configured. Run `agendex login` first.');

  return config;
}

function isAuthenticationFailure(status: number): boolean {
  return status === 401;
}

function reportAuthExpired(status: number): void {
  if (isAuthenticationFailure(status)) credentialStore.onAuthExpired?.();
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
  syncIdentityKey?: string;
  contentHash?: string;
  identityVersion?: number;
  identityStrength?: 'strong' | 'path' | 'content';
}

export interface SyncPlanResult {
  ok: boolean;
  error?: string;
  status?: number;
  skippedLowValue?: boolean;
  deleted?: boolean;
  planId?: string;
  stale?: boolean;
}

export interface CliPreferences {
  collectLocalIpAddress: boolean;
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseSyncSuccess(body: string): SyncPlanResult {
  const result = parseJsonObject(body);
  if (!result) return { ok: true };
  return {
    ok: true,
    skippedLowValue: result.skippedLowValue === true,
    deleted: result.deleted === true,
    stale: result.stale === true,
    ...(typeof result.planId === 'string' && { planId: result.planId }),
  };
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

  if (isAuthenticationFailure(res.status)) {
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
    reportAuthExpired(res.status);
    return { ok: false, status: res.status, error: `${res.status}: ${res.body}` };
  }

  return parseSyncSuccess(res.body);
}

async function refreshStoredToken(currentToken: string, convexUrl: string): Promise<string | null> {
  const refreshed = await refreshToken(currentToken, convexUrl);
  if (!refreshed) return null;

  credentialStore.saveToken(currentToken, refreshed.token);

  return refreshed.token;
}

export async function refreshCurrentDaemonToken(): Promise<boolean> {
  const current = credentialStore.load();
  if (!current) return false;
  return (await refreshStoredToken(current.token, current.convexUrl)) !== null;
}

export async function sendHeartbeat(ipAddress?: string): Promise<void> {
  try {
    const { token, convexUrl } = getCloudConfig();
    const pidInfo = readPidInfo();
    cachedDeviceId ??= loadOrCreateDeviceId();
    const heartbeatBody = JSON.stringify({
      deviceId: cachedDeviceId,
      hostname: pidInfo?.hostname ?? osHostname(),
      startedAtMs: pidInfo?.startedAtMs,
      pid: pidInfo?.pid,
      ipAddress: ipAddress ?? null,
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

    if (isAuthenticationFailure(res.status)) {
      const refreshedToken = await refreshStoredToken(activeToken, convexUrl);
      if (!refreshedToken) {
        reportAuthExpired(res.status);
        return;
      }

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

    if (isAuthenticationFailure(res.status)) {
      reportAuthExpired(res.status);
      return;
    }
  } catch {
    // best-effort, don't crash the daemon
  }
}

export async function sendShutdown(): Promise<void> {
  try {
    getCloudConfig();
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

  const body = parseJsonObject(res.body);
  const token = typeof body?.token === 'string' ? body.token : undefined;
  const expiresAt = typeof body?.expiresAt === 'number' ? body.expiresAt : 0;
  if (!token) return null;
  return { token, expiresAt };
}

export async function fetchCliPreferences(): Promise<CliPreferences | null> {
  try {
    const { token, convexUrl } = getCloudConfig();
    let activeToken = token;
    let res = await requestText(`${convexUrl}/api/cli/preferences`, {
      method: 'GET',
      headers: authHeaders(activeToken),
    });

    if (isAuthenticationFailure(res.status)) {
      const refreshed = await refreshStoredToken(activeToken, convexUrl);
      if (refreshed) {
        activeToken = refreshed;
        res = await requestText(`${convexUrl}/api/cli/preferences`, {
          method: 'GET',
          headers: authHeaders(activeToken),
        });
      }
    }

    if (res.status < 200 || res.status >= 300) {
      reportAuthExpired(res.status);
      return null;
    }

    const body = JSON.parse(res.body) as { collectLocalIpAddress?: unknown };
    if (typeof body.collectLocalIpAddress !== 'boolean') return null;

    const config = loadConfig();
    if (config) {
      saveConfig({
        ...config,
        collectLocalIpAddress: body.collectLocalIpAddress,
      });
    }

    return { collectLocalIpAddress: body.collectLocalIpAddress };
  } catch {
    return null;
  }
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

const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.AGENDEX_HTTP_TIMEOUT_MS ?? '', 10) || 10_000;

function requestText(urlString: string, options: RequestOptions): Promise<TextResponse> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (err) {
    return Promise.reject(err);
  }

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
        timeout: REQUEST_TIMEOUT_MS,
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
    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${url.host} timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

export interface PlannotatorWritebackJob {
  _id: string;
  localPlanId: string;
  deviceId?: string;
  action?: PlannotatorWritebackAction;
  feedback: string;
  revisedContent?: string;
  annotations?: PlannotatorFeedbackAnnotation[];
  source: string;
  expiresAt: number;
}

function authHeaders(token: string, contentType = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Connection: 'close',
    ...(contentType && { 'Content-Type': 'application/json' }),
  };
}

export async function fetchPlannotatorWritebacks(limit = 10): Promise<PlannotatorWritebackJob[]> {
  const { token, convexUrl } = getCloudConfig();
  cachedDeviceId ??= loadOrCreateDeviceId();
  const url = `${convexUrl}/api/cli/plannotator/writebacks?deviceId=${encodeURIComponent(cachedDeviceId)}&limit=${limit}`;
  let activeToken = token;

  let res = await requestText(url, {
    method: 'GET',
    headers: authHeaders(activeToken),
  });

  if (isAuthenticationFailure(res.status)) {
    const refreshed = await refreshStoredToken(activeToken, convexUrl);
    if (refreshed) {
      activeToken = refreshed;
      res = await requestText(url, {
        method: 'GET',
        headers: authHeaders(activeToken),
      });
    }
  }

  if (isAuthenticationFailure(res.status)) {
    reportAuthExpired(res.status);
    throw new AuthExpiredError();
  }
  if (res.status < 200 || res.status >= 300) return [];

  const body = parseJsonObject(res.body);
  return Array.isArray(body?.writebacks) ? (body.writebacks as PlannotatorWritebackJob[]) : [];
}

export async function reportPlannotatorWriteback(
  writebackId: string,
  status: 'sent' | 'failed' | 'expired',
  error?: string,
): Promise<boolean> {
  const { token, convexUrl } = getCloudConfig();
  const url = `${convexUrl}/api/cli/plannotator/writebacks/report`;
  let activeToken = token;
  const body = JSON.stringify({ writebackId, status, error });

  let res = await requestText(url, {
    method: 'POST',
    headers: authHeaders(activeToken, true),
    body,
  });

  if (isAuthenticationFailure(res.status)) {
    const refreshed = await refreshStoredToken(activeToken, convexUrl);
    if (refreshed) {
      activeToken = refreshed;
      res = await requestText(url, {
        method: 'POST',
        headers: authHeaders(activeToken, true),
        body,
      });
    }
  }

  reportAuthExpired(res.status);
  return res.status >= 200 && res.status < 300;
}

export interface DeviceInfo {
  deviceId: string | null;
  hostname: string | null;
  ipAddress: string | null;
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

  if (isAuthenticationFailure(res.status)) {
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

  if (isAuthenticationFailure(res.status)) {
    reportAuthExpired(res.status);
    throw new AuthExpiredError();
  }

  if (res.status < 200 || res.status >= 300) {
    return [];
  }

  const body = parseJsonObject(res.body);
  return Array.isArray(body?.devices) ? (body.devices as DeviceInfo[]) : [];
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

  if (isAuthenticationFailure(res.status)) {
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
    reportAuthExpired(res.status);
    return { ok: false, deleted: 0 };
  }

  const body = parseJsonObject(res.body);
  return {
    ok: body?.ok === true,
    deleted: typeof body?.deleted === 'number' ? body.deleted : 0,
  };
}
