import type { PlanChecklistSummary } from '@agendex/shared/plan-checklist';
import type { PlanReceipt, PlanReceiptSummary } from '@agendex/shared/receipts';
import type { FilePlanHistory } from '@agendex/shared/file-plan-history';

const BASE = '/api/v1';

type ErrorResponse = {
  error?: unknown;
  message?: unknown;
};

function getToken(): string | null {
  return localStorage.getItem('agendex_token');
}

export function setToken(token: string) {
  localStorage.setItem('agendex_token', token);
}

export function clearToken() {
  localStorage.removeItem('agendex_token');
}

export function hasToken(): boolean {
  return !!getToken();
}

async function getErrorMessage(res: Response): Promise<string> {
  const fallback = `${res.status} ${res.statusText}`;
  const contentType = res.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const body = (await res.json()) as ErrorResponse;
      if (typeof body.error === 'string' && body.error.trim()) return body.error;
      if (typeof body.message === 'string' && body.message.trim()) return body.message;
      return fallback;
    }

    const text = await res.text();
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401) {
    clearToken();
    sessionStorage.setItem('agendex_session_expired', '1');
    window.location.reload();
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

/** Prefetched GETs that have not been answered yet, by path. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * GETs `path`, taking over a matching `prefetchGet` request that is still in
 * flight. A prefetch that settles unclaimed is dropped instead of replayed:
 * its data may be out of date by the time anything asks for it, and a failure
 * deserves a fresh attempt.
 */
function get<T>(path: string): Promise<T> {
  const pending = inFlight.get(path);
  if (!pending) return request<T>(path);
  inFlight.delete(path);
  return pending as Promise<T>;
}

function prefetchGet(path: string) {
  const response = request(path);
  inFlight.set(path, response);
  // Handling rejections here also keeps an unclaimed failure from surfacing as
  // an unhandled rejection; a claimed one still rejects for its consumer.
  const drop = () => {
    if (inFlight.get(path) === response) inFlight.delete(path);
  };
  response.then(drop, drop);
}

function plansPath(params?: { agent?: string; q?: string; sort?: string }): string {
  const qs = new URLSearchParams();
  if (params?.agent) qs.set('agent', params.agent);
  if (params?.q) qs.set('q', params.q);
  if (params?.sort) qs.set('sort', params.sort);
  qs.set('limit', '10000');
  return `/plans?${qs.toString()}`;
}

/**
 * Starts the dashboard's initial requests before its code has loaded, so the
 * plan list downloads alongside the JavaScript instead of after it. The
 * dashboard's first matching `api.getPlans` / `api.getAgents` call takes over
 * a request that is still in flight. Requires a stored token.
 */
export function prefetchDashboardData({ sort }: { sort: string }) {
  if (!hasToken()) return;
  prefetchGet(plansPath({ sort }));
  prefetchGet('/agents');
}

export interface Plan {
  id: string;
  /** Stable ID assigned by the local scanner before this plan was synced. */
  localPlanId?: string;
  ownerId?: string;
  agent: string;
  title: string;
  content: string;
  filePath: string;
  format: string;
  createdAt: string;
  updatedAt: string;
  workspace?: string;
  metadata: Record<string, unknown>;
  /** Checklist progress for rows shipped without content (cloud lists). */
  checklist?: PlanChecklistSummary;
}

export interface PlansResponse {
  plans: Plan[];
  total: number;
  limit: number;
  offset: number;
}

export interface AgentStats {
  agent: string;
  planCount: number;
  writable: boolean;
}

export interface UsageTokenTotals {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface AgentUsageTotals {
  agent: string;
  totals: UsageTokenTotals;
  totalTokens: number;
  costUsd: number;
  records: number;
  unpricedRecords: number;
  sessions: number;
}

export interface ModelUsageTotals {
  agent: string;
  model: string;
  totals: UsageTokenTotals;
  totalTokens: number;
  costUsd: number;
  records: number;
  unpricedRecords: number;
}

export interface UsageBucket {
  /** `YYYY-MM-DD` for day resolution; ISO hour start for hour resolution. */
  start: string;
  costUsd: number;
  totalTokens: number;
  byAgent: Record<string, { costUsd: number; totalTokens: number }>;
}

export interface UsageSummary {
  generatedAt: string;
  days: number;
  resolution: 'day' | 'hour';
  buckets: UsageBucket[];
  totals: UsageTokenTotals;
  totalTokens: number;
  costUsd: number;
  cacheSavingsUsd: number;
  records: number;
  unpricedRecords: number;
  sessions: number;
  agents: AgentUsageTotals[];
  models: ModelUsageTotals[];
  sources: { agent: string; path: string; status: string; files: number; message?: string }[];
  scanDurationMs: number;
  dedupeKeys?: string[];
}

export interface PlanAnnotationApiRecord {
  id: string;
  planId?: string;
  authorId?: string;
  authorName?: string;
  source?: string;
  type: 'comment' | 'replacement' | 'deletion' | 'insertion' | 'global_comment';
  status: 'draft' | 'open' | 'submitted' | 'resolved';
  body?: string;
  replacementText?: string;
  anchor: {
    quote?: string;
    startOffset?: number;
    endOffset?: number;
    occurrenceIndex?: number;
    prefix?: string;
    suffix?: string;
    contentHash?: string;
  };
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  resolvedAt?: number;
  writebackId?: string;
}

export type PathExistsApiResult =
  | { status: 'found'; resolved: string; relative: string }
  | { status: 'ambiguous'; matches: string[] }
  | { status: 'missing' }
  | { status: 'unavailable' };

export interface OpenInAppInfo {
  id: string;
  label: string;
  kind: 'editor' | 'file-manager';
}

export const api = {
  getPlans: (params?: { agent?: string; q?: string; sort?: string }) =>
    get<PlansResponse>(plansPath(params)),

  getPlan: (id: string) => request<Plan>(`/plans/${id}`),

  getAgents: () => get<AgentStats[]>('/agents'),

  getUsage: (days?: number, refresh?: boolean) => {
    const params = new URLSearchParams();
    if (days) params.set('days', String(days));
    if (refresh) params.set('refresh', '1');
    const query = params.toString();
    return request<UsageSummary>(`/usage${query ? `?${query}` : ''}`);
  },

  rescan: () => request<{ ok: boolean }>('/rescan', { method: 'POST' }),

  createPlan: (agent: string, title: string, content: string) =>
    request<Plan>('/plans', {
      method: 'POST',
      body: JSON.stringify({ agent, title, content }),
    }),

  updatePlan: (id: string, content: string) =>
    request<Plan>(`/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),

  getPlanAnnotations: (id: string) =>
    request<{ annotations: PlanAnnotationApiRecord[] }>(`/plans/${id}/annotations`),

  createPlanAnnotation: (
    id: string,
    annotation: Pick<PlanAnnotationApiRecord, 'type' | 'anchor'> &
      Partial<Pick<PlanAnnotationApiRecord, 'body' | 'replacementText' | 'status'>>,
  ) =>
    request<PlanAnnotationApiRecord>(`/plans/${id}/annotations`, {
      method: 'POST',
      body: JSON.stringify(annotation),
    }),

  updatePlanAnnotationStatus: (
    id: string,
    annotationId: string,
    status?: PlanAnnotationApiRecord['status'],
    writebackId?: string,
  ) => {
    const body: { status?: PlanAnnotationApiRecord['status']; writebackId?: string } = {};
    if (status !== undefined) body.status = status;
    if (writebackId !== undefined) body.writebackId = writebackId;

    return request<PlanAnnotationApiRecord>(`/plans/${id}/annotations/${annotationId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  deletePlanAnnotation: (id: string, annotationId: string) =>
    request<{ ok: boolean }>(`/plans/${id}/annotations/${annotationId}`, { method: 'DELETE' }),

  checkPlanPaths: (id: string, paths: string[], sourceFilePath?: string) =>
    request<{ results: Record<string, PathExistsApiResult> }>(`/plans/${id}/paths/exists`, {
      method: 'POST',
      body: JSON.stringify({ paths, sourceFilePath }),
    }),

  getPlanReceipt: (id: string) =>
    request<{ receipt: PlanReceipt }>(`/plans/${encodeURIComponent(id)}/receipt`),

  getPlanReceiptSummaries: () =>
    request<{ receipts: Record<string, PlanReceiptSummary> }>('/receipts'),

  getFilePlanHistory: (
    path: string,
    options: {
      workspace?: string;
      allWorkspaces?: boolean;
      offset?: number;
      signal?: AbortSignal;
    } = {},
  ) => {
    const query = new URLSearchParams({ path, limit: '100', offset: String(options.offset ?? 0) });
    if (options.workspace) query.set('workspace', options.workspace);
    if (options.allWorkspaces) query.set('allWorkspaces', 'true');
    return request<FilePlanHistory>(`/file-plans?${query}`, { signal: options.signal });
  },

  getFilePlanCounts: (paths: string[], workspace?: string, signal?: AbortSignal) =>
    request<{ counts: Array<{ path: string; count: number; exact: boolean }> }>(
      '/file-plan-counts',
      {
        method: 'POST',
        body: JSON.stringify({ paths, workspace, allWorkspaces: !workspace }),
        signal,
      },
    ),

  getOpenInApps: () => request<{ available: boolean; apps: OpenInAppInfo[] }>('/open-in/apps'),

  openPlanPath: (
    id: string,
    path: string,
    line?: number,
    appId?: string,
    sourceFilePath?: string,
  ) =>
    request<{ ok: boolean; error?: string }>(`/plans/${id}/open-in`, {
      method: 'POST',
      body: JSON.stringify({ path, line, appId, sourceFilePath }),
    }),

  getPlanSources: () => request<{ customPlanDirs: string[] }>('/plan-sources'),

  addPlanSource: (path: string) =>
    request<{ customPlanDirs: string[] }>('/plan-sources', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  removePlanSource: (path: string) =>
    request<{ customPlanDirs: string[] }>('/plan-sources', {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    }),
};
