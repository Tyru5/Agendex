import { loadConfig } from '@agendex/shared';

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

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(plan),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `${res.status}: ${body}` };
  }

  return { ok: true };
}

export async function sendHeartbeat(): Promise<void> {
  const { token, convexUrl } = getCloudConfig();
  try {
    await fetch(`${convexUrl}/api/cli/heartbeat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    // best-effort, don't crash the daemon
  }
}

export async function refreshToken(
  currentToken: string,
  convexUrl: string,
): Promise<{ token: string; expiresAt: number } | null> {
  const res = await fetch(`${convexUrl}/api/cli/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${currentToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) return null;

  const body = (await res.json()) as { token?: string; expiresAt?: number };
  if (!body.token) return null;
  return { token: body.token, expiresAt: body.expiresAt ?? 0 };
}
