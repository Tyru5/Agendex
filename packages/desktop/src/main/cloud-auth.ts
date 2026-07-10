import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeConvexSiteUrl } from '@agendex/shared/convex-url';
import { app, safeStorage } from 'electron';

/** Cloud session captured from the system-browser auth flow. */
export interface CloudCreds {
  token: string;
  convexSiteUrl: string;
  accountId?: string;
}

export interface ConvexAuthTokenResult {
  token: string;
  cloudSession: CloudCreds;
}

const PROD_SITE_URL = 'https://app.agendex.dev';
const DEV_SITE_URL = 'http://app.agendex.localhost:5174';
const QA_PLAINTEXT_ENC = 'qa-plaintext';

/** Hosted Agendex site that serves the desktop sign-in handshake. */
export function getSiteUrl(isDev: boolean): string {
  return process.env.AGENDEX_SITE_URL ?? (isDev ? DEV_SITE_URL : PROD_SITE_URL);
}

function credsPath(): string {
  return join(app.getPath('userData'), 'agendex-cloud.json');
}

let cache: CloudCreds | null | undefined;

function sameCloudCreds(left: CloudCreds | null, right: CloudCreds): boolean {
  return (
    left?.token === right.token &&
    left.convexSiteUrl === right.convexSiteUrl &&
    left.accountId === right.accountId
  );
}

function allowsQaPlaintextCloudCreds(): boolean {
  return process.env.AGENDEX_DESKTOP_QA_ALLOW_PLAINTEXT_CLOUD_CREDS === 'true';
}

export function loadCloudCreds(): CloudCreds | null {
  if (cache) return cache;
  try {
    const path = credsPath();
    if (!existsSync(path)) {
      cache = null;
      return cache;
    }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      token?: string;
      enc?: boolean | string;
      convexSiteUrl?: string;
      accountId?: string;
    };

    // Fail closed: only ever trust tokens we wrote encrypted via safeStorage.
    // A plaintext (`enc !== true`) token means the file was hand-written or
    // produced by an environment without OS encryption — ignore it rather than
    // use a credential that was sitting on disk in cleartext.
    if (!raw.token) {
      cache = null;
      return cache;
    }

    const convexSiteUrl = normalizeConvexSiteUrl(raw.convexSiteUrl ?? '');
    if (!convexSiteUrl) {
      console.warn(
        '[agendex-desktop] stored cloud creds reference an untrusted Convex URL; ignoring session',
      );
      cache = null;
      return cache;
    }
    const accountId = raw.accountId?.trim() || undefined;
    const session = { token: raw.token, convexSiteUrl, ...(accountId ? { accountId } : {}) };

    if (raw.enc === QA_PLAINTEXT_ENC) {
      cache = allowsQaPlaintextCloudCreds() ? session : null;
      return cache;
    }

    if (raw.enc !== true) {
      cache = null;
      return cache;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(
        '[agendex-desktop] encrypted cloud creds require safeStorage; ignoring stored session',
      );
      cache = null;
      return cache;
    }

    const token = safeStorage.decryptString(Buffer.from(raw.token, 'base64'));
    cache = token ? { ...session, token } : null;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] failed to load cloud creds', error);
    cache = null;
  }
  return cache;
}

export function saveCloudCreds(creds: CloudCreds): void {
  const convexSiteUrl = normalizeConvexSiteUrl(creds.convexSiteUrl);
  if (!convexSiteUrl) {
    throw new Error(
      `Refusing to persist cloud session with an untrusted Convex URL: ${creds.convexSiteUrl}`,
    );
  }

  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const accountId = creds.accountId?.trim() || undefined;
  const session = { token: creds.token, convexSiteUrl, ...(accountId ? { accountId } : {}) };
  if (allowsQaPlaintextCloudCreds()) {
    writeFileSync(credsPath(), JSON.stringify({ ...session, enc: QA_PLAINTEXT_ENC }), 'utf8');
    cache = session;
    return;
  }

  // Fail closed rather than persisting a long-lived bearer token in plaintext.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS secure storage (safeStorage) is unavailable; refusing to persist cloud session in plaintext',
    );
  }
  const token = safeStorage.encryptString(creds.token).toString('base64');
  writeFileSync(credsPath(), JSON.stringify({ ...session, token, enc: true }), 'utf8');
  cache = session;
}

export function clearCloudCreds(): void {
  try {
    const path = credsPath();
    if (existsSync(path)) rmSync(path);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] failed to clear cloud creds', error);
  }
  cache = null;
}

function getResponseToken(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('token' in body)) return null;
  const token = body.token;
  return typeof token === 'string' && token.trim() ? token : null;
}

function getResponseAccountId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('accountId' in body)) return null;
  const accountId = body.accountId;
  return typeof accountId === 'string' && accountId.trim() ? accountId : null;
}

function sessionAuthHeaders(sessionToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${sessionToken}`,
  };
}

function getCliRefreshUrl(convexSiteUrl: string): string | null {
  const siteUrl = normalizeConvexSiteUrl(convexSiteUrl);
  return siteUrl ? `${siteUrl}/api/cli/refresh` : null;
}

function getCliConvexTokenUrl(convexSiteUrl: string): string | null {
  const siteUrl = normalizeConvexSiteUrl(convexSiteUrl);
  return siteUrl ? `${siteUrl}/api/cli/convex-token` : null;
}

/** Re-validates the stored cloud session and persists a rotated token when returned. */
export async function refreshCloudSession(): Promise<CloudCreds | null> {
  const creds = loadCloudCreds();
  if (!creds) return null;

  const refreshUrl = getCliRefreshUrl(creds.convexSiteUrl);
  if (!refreshUrl) {
    clearCloudCreds();
    return null;
  }

  try {
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: sessionAuthHeaders(creds.token),
    });
    // 401/403 mean the session is invalid (expired or revoked): clear it and
    // drop to the sign-in gate rather than caching a dead token that the
    // renderer would keep retrying. Other non-OK statuses (5xx, 429, transient
    // outages) are not proof the session is bad, so keep the existing creds and
    // let a later refresh retry instead of needlessly signing the user out.
    if (res.status === 401 || res.status === 403) {
      const current = loadCloudCreds();
      if (!sameCloudCreds(current, creds)) return current;
      clearCloudCreds();
      return null;
    }
    if (!res.ok) {
      const current = loadCloudCreds();
      return sameCloudCreds(current, creds) ? creds : current;
    }

    const body = await res.json();
    const refreshedToken = getResponseToken(body);
    const accountId = getResponseAccountId(body) ?? creds.accountId;
    const current = loadCloudCreds();
    if (!sameCloudCreds(current, creds)) return current;
    if (refreshedToken && (refreshedToken !== creds.token || accountId !== creds.accountId)) {
      const refreshed = { ...creds, token: refreshedToken, accountId };
      saveCloudCreds(refreshed);
      return refreshed;
    }
    return creds;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] cloud session refresh failed', error);
    const current = loadCloudCreds();
    return sameCloudCreds(current, creds) ? creds : current;
  }
}

export async function validateCloudCreds(creds: CloudCreds): Promise<CloudCreds | null> {
  const refreshUrl = getCliRefreshUrl(creds.convexSiteUrl);
  if (!refreshUrl) return null;

  try {
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: sessionAuthHeaders(creds.token),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const refreshedToken = getResponseToken(body);
    const accountId = getResponseAccountId(body);
    return refreshedToken && accountId ? { ...creds, token: refreshedToken, accountId } : null;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] cloud creds validation failed', error);
    return null;
  }
}

async function requestConvexAuthToken(
  creds: CloudCreds,
  hasRetried: boolean,
): Promise<ConvexAuthTokenResult | null> {
  const tokenUrl = getCliConvexTokenUrl(creds.convexSiteUrl);
  if (!tokenUrl) {
    if (sameCloudCreds(loadCloudCreds(), creds)) clearCloudCreds();
    return null;
  }

  try {
    const res = await fetch(tokenUrl, {
      method: 'GET',
      headers: sessionAuthHeaders(creds.token),
    });

    if ((res.status === 401 || res.status === 403) && !hasRetried) {
      const refreshed = await refreshCloudSession();
      return refreshed ? requestConvexAuthToken(refreshed, true) : null;
    }
    if (res.status === 401 || res.status === 403) {
      if (sameCloudCreds(loadCloudCreds(), creds)) clearCloudCreds();
      return null;
    }
    if (!res.ok) return null;

    const token = getResponseToken(await res.json());
    if (!sameCloudCreds(loadCloudCreds(), creds)) return null;
    return token ? { token, cloudSession: creds } : null;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[agendex-desktop] convex auth token request failed', error);
    return null;
  }
}

export async function getConvexAuthToken(): Promise<ConvexAuthTokenResult | null> {
  const creds = loadCloudCreds();
  if (!creds) return null;
  return requestConvexAuthToken(creds, false);
}
