import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostname as osHostname } from 'node:os';
import {
  loadConfig,
  loadOrCreateDeviceId,
  type PlannotatorFeedbackAnnotation,
  type PlannotatorWritebackAction,
  type UsageSummary,
  updateConfig,
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
  accountId?: string;
}

export interface DaemonCredentialStore {
  load: () => DaemonCloudCredentials | null;
  saveToken: (current: DaemonCloudCredentials, nextToken: string, accountId: string) => boolean;
  onAuthExpired?: (failedToken: string) => void;
}

const configCredentialStore: DaemonCredentialStore = {
  load: () => {
    const config = loadConfig();
    if (!config?.cloudToken || !config.convexUrl) return null;
    return {
      token: config.cloudToken,
      convexUrl: config.convexUrl,
      accountId: config.cloudAccountId,
    };
  },
  saveToken: (current, nextToken, accountId) =>
    updateConfig((config) => {
      if (
        !config ||
        config.cloudToken !== current.token ||
        config.convexUrl !== current.convexUrl
      ) {
        return null;
      }
      return { ...config, cloudToken: nextToken, cloudAccountId: accountId };
    }),
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

export function getDaemonCloudScope(): string | null {
  const credentials = credentialStore.load();
  if (!credentials) return null;
  return createHash('sha256')
    .update(`${credentials.convexUrl}\0${credentials.accountId ?? credentials.token}`)
    .digest('hex')
    .slice(0, 32);
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

function reportAuthExpired(status: number, failedToken: string): void {
  if (isAuthenticationFailure(status)) credentialStore.onAuthExpired?.(failedToken);
}

type TokenRefreshRequestResult =
  | { kind: 'refreshed'; token: string; accountId: string; expiresAt: number }
  | { kind: 'auth-rejected' }
  | { kind: 'unavailable' };

type StoredTokenRefreshResult =
  | { kind: 'refreshed'; credentials: DaemonCloudCredentials }
  | { kind: 'auth-rejected' | 'unavailable' | 'credentials-changed' };

function reportRefreshRejection(result: StoredTokenRefreshResult, failedToken: string): void {
  if (result.kind === 'auth-rejected') reportAuthExpired(401, failedToken);
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

export interface CloudPlanDownload {
  id: string;
  localPlanId?: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath: string;
  workspace?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudPlanDownloadMatch {
  id: string;
  localPlanId?: string;
  agent: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  /** Logical duplicate keys from the server; rows sharing any are the same plan. */
  dedupeKeys?: string[];
}
export interface CloudPlanDownloadPagination {
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
}

export type FetchCloudPlanResult =
  | { kind: 'found'; plan: CloudPlanDownload }
  | {
      kind: 'ambiguous';
      matches: CloudPlanDownloadMatch[];
      pagination: CloudPlanDownloadPagination;
    }
  | { kind: 'not_found'; suggestions: CloudPlanDownloadMatch[] }
  | { kind: 'auth-expired' }
  | { kind: 'error'; status: number; message: string };

export interface ListCloudPlansOptions {
  query?: string;
  agent?: string;
  cursor?: string;
}

export type ListCloudPlansResult =
  | {
      kind: 'ok';
      plans: CloudPlanDownloadMatch[];
      continueCursor: string | null;
      isDone: boolean;
    }
  | { kind: 'auth-expired' }
  | { kind: 'error'; status: number; message: string };

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseCloudPlanDownload(value: unknown): CloudPlanDownload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if (
    typeof plan.id !== 'string' ||
    typeof plan.agent !== 'string' ||
    typeof plan.title !== 'string' ||
    typeof plan.content !== 'string' ||
    typeof plan.format !== 'string' ||
    typeof plan.filePath !== 'string' ||
    typeof plan.createdAt !== 'string' ||
    typeof plan.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: plan.id,
    localPlanId: readOptionalString(plan.localPlanId),
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    filePath: plan.filePath,
    workspace: readOptionalString(plan.workspace),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function parseCloudPlanDownloadMatch(value: unknown): CloudPlanDownloadMatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if (
    typeof plan.id !== 'string' ||
    typeof plan.agent !== 'string' ||
    typeof plan.title !== 'string' ||
    typeof plan.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: plan.id,
    localPlanId: readOptionalString(plan.localPlanId),
    agent: plan.agent,
    title: plan.title,
    updatedAt: plan.updatedAt,
    createdAt: readOptionalString(plan.createdAt),
    dedupeKeys: Array.isArray(plan.dedupeKeys)
      ? plan.dedupeKeys.filter((key): key is string => typeof key === 'string')
      : undefined,
  };
}

function parseCloudPlanDownloadPagination(value: unknown): CloudPlanDownloadPagination | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const pagination = value as Record<string, unknown>;
  const nextCursor =
    pagination.nextCursor === null
      ? null
      : typeof pagination.nextCursor === 'string' && pagination.nextCursor.length > 0
        ? pagination.nextCursor
        : undefined;
  if (
    nextCursor === undefined ||
    typeof pagination.hasMore !== 'boolean' ||
    typeof pagination.pageSize !== 'number' ||
    !Number.isInteger(pagination.pageSize) ||
    pagination.pageSize < 1 ||
    pagination.pageSize > 100 ||
    (pagination.hasMore && nextCursor === null)
  ) {
    return null;
  }
  return {
    nextCursor,
    hasMore: pagination.hasMore,
    pageSize: pagination.pageSize,
  };
}

export async function fetchCloudPlan(
  query: string,
  agent?: string,
  cursor?: string,
): Promise<FetchCloudPlanResult> {
  const { token, convexUrl } = getCloudConfig();
  const params = new URLSearchParams({ q: query });
  if (agent) params.set('agent', agent);
  if (cursor) params.set('cursor', cursor);
  const url = `${convexUrl}/api/cli/plan?${params.toString()}`;
  let activeToken = token;

  let res = await requestText(url, {
    method: 'GET',
    headers: authHeaders(activeToken),
  });

  if (isAuthenticationFailure(res.status)) {
    const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
    if (refreshed.kind === 'refreshed') {
      activeToken = refreshed.credentials.token;
      res = await requestText(url, {
        method: 'GET',
        headers: authHeaders(activeToken),
      });
    } else {
      reportRefreshRejection(refreshed, activeToken);
      if (refreshed.kind === 'auth-rejected') return { kind: 'auth-expired' };
      return {
        kind: 'error',
        status: refreshed.kind === 'credentials-changed' ? 409 : 503,
        message:
          refreshed.kind === 'credentials-changed'
            ? 'Cloud credentials changed during download'
            : 'Cloud session refresh unavailable',
      };
    }
  }

  if (isAuthenticationFailure(res.status)) {
    reportAuthExpired(res.status, activeToken);
    return { kind: 'auth-expired' };
  }

  const body = parseJsonObject(res.body);

  if (body?.status === 'not_found') {
    const suggestions = Array.isArray(body?.suggestions)
      ? body.suggestions.flatMap((entry) => {
          const match = parseCloudPlanDownloadMatch(entry);
          return match ? [match] : [];
        })
      : [];
    return { kind: 'not_found', suggestions };
  }

  if (res.status === 404) {
    const message =
      typeof body?.error === 'string' && body.error
        ? body.error
        : 'Cloud download is not available on this server. Update the Agendex cloud deployment or check that you are logged into the right host.';
    return { kind: 'error', status: 404, message };
  }

  if (body?.status === 'ambiguous') {
    const matches = Array.isArray(body?.matches)
      ? body.matches.flatMap((entry) => {
          const match = parseCloudPlanDownloadMatch(entry);
          return match ? [match] : [];
        })
      : [];
    const pagination = parseCloudPlanDownloadPagination(body.pagination);
    if (!pagination) {
      return {
        kind: 'error',
        status: res.status,
        message: 'Cloud returned invalid ambiguity pagination',
      };
    }
    return { kind: 'ambiguous', matches, pagination };
  }

  if (res.status >= 200 && res.status < 300 && body?.status === 'found') {
    const plan = parseCloudPlanDownload(body.plan);
    if (plan) return { kind: 'found', plan };
    return { kind: 'error', status: res.status, message: 'Cloud returned an invalid plan payload' };
  }

  const message =
    typeof body?.error === 'string' && body.error
      ? body.error
      : `${res.status}: ${res.body || 'unknown error'}`;
  return { kind: 'error', status: res.status, message };
}

export async function listCloudPlans(
  options: ListCloudPlansOptions = {},
): Promise<ListCloudPlansResult> {
  const { token, convexUrl } = getCloudConfig();
  const params = new URLSearchParams();
  if (options.query) params.set('q', options.query);
  if (options.agent) params.set('agent', options.agent);
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  const url = query ? `${convexUrl}/api/cli/plans?${query}` : `${convexUrl}/api/cli/plans`;
  let activeToken = token;

  let res = await requestText(url, {
    method: 'GET',
    headers: authHeaders(activeToken),
  });

  if (isAuthenticationFailure(res.status)) {
    const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
    if (refreshed.kind === 'refreshed') {
      activeToken = refreshed.credentials.token;
      res = await requestText(url, {
        method: 'GET',
        headers: authHeaders(activeToken),
      });
    } else {
      reportRefreshRejection(refreshed, activeToken);
      if (refreshed.kind === 'auth-rejected') return { kind: 'auth-expired' };
      return {
        kind: 'error',
        status: refreshed.kind === 'credentials-changed' ? 409 : 503,
        message:
          refreshed.kind === 'credentials-changed'
            ? 'Cloud credentials changed during browse'
            : 'Cloud session refresh unavailable',
      };
    }
  }

  if (isAuthenticationFailure(res.status)) {
    reportAuthExpired(res.status, activeToken);
    return { kind: 'auth-expired' };
  }

  const body = parseJsonObject(res.body);

  if (res.status === 404) {
    const message =
      typeof body?.error === 'string' && body.error
        ? body.error
        : 'Cloud browse is not available on this server. Update the Agendex cloud deployment or check that you are logged into the right host.';
    return { kind: 'error', status: 404, message };
  }

  if (res.status >= 200 && res.status < 300 && body?.status === 'ok') {
    const plans = Array.isArray(body.plans)
      ? body.plans.flatMap((entry) => {
          const match = parseCloudPlanDownloadMatch(entry);
          return match ? [match] : [];
        })
      : [];
    const continueCursor = typeof body.continueCursor === 'string' ? body.continueCursor : null;
    return {
      kind: 'ok',
      plans,
      continueCursor,
      isDone: body.isDone !== false,
    };
  }

  const message =
    typeof body?.error === 'string' && body.error
      ? body.error
      : `${res.status}: ${res.body || 'unknown error'}`;
  return { kind: 'error', status: res.status, message };
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
    const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
    if (refreshed.kind === 'refreshed') {
      activeToken = refreshed.credentials.token;
      res = await requestText(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Connection: 'close',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(plan),
      });
    } else {
      reportRefreshRejection(refreshed, activeToken);
      return {
        ok: false,
        status: refreshed.kind === 'auth-rejected' ? 401 : 503,
        error:
          refreshed.kind === 'auth-rejected'
            ? '401: Unauthorized'
            : refreshed.kind === 'credentials-changed'
              ? 'Cloud credentials changed during sync'
              : 'Cloud session refresh unavailable',
      };
    }
  }

  if (res.status < 200 || res.status >= 300) {
    reportAuthExpired(res.status, activeToken);
    return { ok: false, status: res.status, error: `${res.status}: ${res.body}` };
  }

  return parseSyncSuccess(res.body);
}

async function refreshStoredToken(
  current: DaemonCloudCredentials,
): Promise<StoredTokenRefreshResult> {
  const refreshed = await requestTokenRefresh(current.token, current.convexUrl);
  if (refreshed.kind !== 'refreshed') return refreshed;
  if (!credentialStore.saveToken(current, refreshed.token, refreshed.accountId)) {
    return { kind: 'credentials-changed' };
  }
  return {
    kind: 'refreshed',
    credentials: { ...current, token: refreshed.token, accountId: refreshed.accountId },
  };
}

export async function refreshCurrentDaemonToken(): Promise<boolean> {
  const current = credentialStore.load();
  if (!current) return false;
  const refreshed = await refreshStoredToken(current);
  reportRefreshRejection(refreshed, current.token);
  return refreshed.kind === 'refreshed';
}

export async function sendHeartbeat(
  ipAddress?: string,
  usageSnapshots?: Readonly<Record<string, UsageSummary>>,
): Promise<void> {
  if (!hasDaemonCloudCredentials()) return;

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
      ...(usageSnapshots && { usageSnapshots }),
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
      const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
      if (refreshed.kind !== 'refreshed') {
        reportRefreshRejection(refreshed, activeToken);
        if (usageSnapshots) {
          const status = refreshed.kind === 'auth-rejected' ? 401 : 503;
          const detail =
            refreshed.kind === 'auth-rejected'
              ? 'Cloud authentication rejected'
              : refreshed.kind === 'credentials-changed'
                ? 'Cloud credentials changed during refresh'
                : 'Cloud session refresh unavailable';
          throw new Error(`Cloud rejected usage heartbeat (${status}): ${detail}`);
        }
        return;
      }

      activeToken = refreshed.credentials.token;
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

    if (res.status < 200 || res.status >= 300) {
      const authenticationFailure = isAuthenticationFailure(res.status);
      if (authenticationFailure) reportAuthExpired(res.status, activeToken);
      if (usageSnapshots) {
        const detail = authenticationFailure
          ? 'authentication failed after refresh'
          : 'request failed';
        throw new Error(`Cloud rejected usage heartbeat (${res.status}): ${detail}`);
      }
      return;
    }
  } catch (error) {
    if (usageSnapshots) throw error;
    // Plain liveness heartbeats remain best-effort.
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
): Promise<{ token: string; accountId: string; expiresAt: number } | null> {
  const result = await requestTokenRefresh(currentToken, convexUrl);
  return result.kind === 'refreshed'
    ? { token: result.token, accountId: result.accountId, expiresAt: result.expiresAt }
    : null;
}

async function requestTokenRefresh(
  currentToken: string,
  convexUrl: string,
): Promise<TokenRefreshRequestResult> {
  const res = await requestText(`${convexUrl}/api/cli/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${currentToken}`,
      Connection: 'close',
      'Content-Type': 'application/json',
    },
  });

  if (isAuthenticationFailure(res.status)) return { kind: 'auth-rejected' };
  if (res.status < 200 || res.status >= 300) return { kind: 'unavailable' };

  const body = parseJsonObject(res.body);
  const token = typeof body?.token === 'string' ? body.token : undefined;
  const accountId = typeof body?.accountId === 'string' ? body.accountId : undefined;
  const expiresAt = typeof body?.expiresAt === 'number' ? body.expiresAt : 0;
  if (!token || !accountId) return { kind: 'unavailable' };
  return { kind: 'refreshed', token, accountId, expiresAt };
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
      const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
      if (refreshed.kind === 'refreshed') {
        activeToken = refreshed.credentials.token;
        res = await requestText(`${convexUrl}/api/cli/preferences`, {
          method: 'GET',
          headers: authHeaders(activeToken),
        });
      } else {
        reportRefreshRejection(refreshed, activeToken);
        return null;
      }
    }

    if (res.status < 200 || res.status >= 300) {
      reportAuthExpired(res.status, activeToken);
      return null;
    }

    const body = JSON.parse(res.body) as { collectLocalIpAddress?: unknown };
    if (typeof body.collectLocalIpAddress !== 'boolean') return null;

    updateConfig((config) =>
      config
        ? {
            ...config,
            collectLocalIpAddress: body.collectLocalIpAddress as boolean,
          }
        : null,
    );

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
    const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
    if (refreshed.kind === 'refreshed') {
      activeToken = refreshed.credentials.token;
      res = await requestText(url, {
        method: 'GET',
        headers: authHeaders(activeToken),
      });
    } else {
      reportRefreshRejection(refreshed, activeToken);
      if (refreshed.kind === 'auth-rejected') throw new AuthExpiredError();
      return [];
    }
  }

  if (isAuthenticationFailure(res.status)) {
    reportAuthExpired(res.status, activeToken);
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
    const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
    if (refreshed.kind === 'refreshed') {
      activeToken = refreshed.credentials.token;
      res = await requestText(url, {
        method: 'POST',
        headers: authHeaders(activeToken, true),
        body,
      });
    } else {
      reportRefreshRejection(refreshed, activeToken);
      return false;
    }
  }

  reportAuthExpired(res.status, activeToken);
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
    const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
    if (refreshed.kind === 'refreshed') {
      activeToken = refreshed.credentials.token;
      res = await requestText(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Connection: 'close',
        },
      });
    } else {
      reportRefreshRejection(refreshed, activeToken);
      if (refreshed.kind === 'auth-rejected') throw new AuthExpiredError();
      return [];
    }
  }

  if (isAuthenticationFailure(res.status)) {
    reportAuthExpired(res.status, activeToken);
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
    const refreshed = await refreshStoredToken({ token: activeToken, convexUrl });
    if (refreshed.kind === 'refreshed') {
      activeToken = refreshed.credentials.token;
      res = await requestText(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Connection: 'close',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceIds }),
      });
    } else {
      reportRefreshRejection(refreshed, activeToken);
      return { ok: false, deleted: 0 };
    }
  }

  if (res.status < 200 || res.status >= 300) {
    reportAuthExpired(res.status, activeToken);
    return { ok: false, deleted: 0 };
  }

  const body = parseJsonObject(res.body);
  return {
    ok: body?.ok === true,
    deleted: typeof body?.deleted === 'number' ? body.deleted : 0,
  };
}
