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
  getPlans: (params?: { agent?: string; q?: string; sort?: string }) => {
    const qs = new URLSearchParams();
    if (params?.agent) qs.set('agent', params.agent);
    if (params?.q) qs.set('q', params.q);
    if (params?.sort) qs.set('sort', params.sort);
    qs.set('limit', '10000');
    const query = qs.toString();
    return request<PlansResponse>(`/plans${query ? `?${query}` : ''}`);
  },

  getPlan: (id: string) => request<Plan>(`/plans/${id}`),

  getAgents: () => request<AgentStats[]>('/agents'),

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
