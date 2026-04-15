const BASE = '/api/v1';

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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface Plan {
  id: string;
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
