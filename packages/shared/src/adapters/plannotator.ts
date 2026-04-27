import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { hashPath } from '../hash.ts';
import type {
  AgentAdapter,
  Plan,
  PlannotatorFeedbackAnnotation,
  PlannotatorMetadata,
  PlannotatorMode,
  PlannotatorStatus,
  PlannotatorWritebackPayload,
} from '../types.ts';

const REQUEST_TIMEOUT_MS = 5_000;
const PROJECT_PLANS_DIRNAME = '@plans';

function getPlannotatorDir(): string {
  return process.env.AGENDEX_PLANNOTATOR_DIR || join(homedir(), '.plannotator');
}

function getPlansDir(): string {
  return join(getPlannotatorDir(), 'plans');
}

function getSessionsDir(): string {
  return join(getPlannotatorDir(), 'sessions');
}

interface SessionInfo {
  pid?: number;
  port?: number;
  url?: string;
  mode?: PlannotatorMode;
  project?: string;
  startedAt?: string;
  label?: string;
  origin?: string;
  reviewId?: string;
  sourcePlanPath?: string;
}

interface PlanResponse {
  plan?: string;
  origin?: string;
  mode?: PlannotatorMode;
  filePath?: string;
  projectRoot?: string;
  versionInfo?: {
    project?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeStatusFromFilename(filePath: string): PlannotatorStatus {
  const name = basename(filePath, '.md');
  if (name.endsWith('-approved')) return 'approved';
  if (name.endsWith('-denied')) return 'denied';
  return 'unknown';
}

function stripStatusSuffix(title: string): string {
  return title.replace(/-(approved|denied)$/i, '');
}

function cleanTitle(title: string): string {
  return title
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(content: string, filePath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/^Plan:\s*/i, '').trim();

  const name = stripStatusSuffix(basename(filePath, '.md'));
  return cleanTitle(name) || 'Plannotator Plan';
}

function isAnnotationFile(filePath: string): boolean {
  return filePath.endsWith('.annotations.md');
}

function isSnapshotFile(filePath: string): boolean {
  if (!filePath.endsWith('.md')) return false;
  if (isAnnotationFile(filePath)) return false;
  const status = normalizeStatusFromFilename(filePath);
  return status === 'approved' || status === 'denied';
}

function isProjectPlansPath(filePath: string): boolean {
  return resolve(filePath).split(sep).includes(PROJECT_PLANS_DIRNAME);
}

function projectPlansDirForPath(filePath: string): string | undefined {
  const parts = resolve(filePath).split(sep);
  const index = parts.lastIndexOf(PROJECT_PLANS_DIRNAME);
  if (index === -1) return undefined;
  return parts.slice(0, index + 1).join(sep) || sep;
}

function isProjectPlanFile(filePath: string): boolean {
  return filePath.endsWith('.md') && !isAnnotationFile(filePath) && isProjectPlansPath(filePath);
}

function isSessionFile(filePath: string): boolean {
  return filePath.endsWith('.json');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isSafePlannotatorUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:') return false;
    if (url.username || url.password) return false;
    if (url.pathname !== '/' && url.pathname !== '') return false;
    if (url.search || url.hash) return false;

    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost') return true;
    if (hostname === '127.0.0.1') return true;
    if (hostname === '::1' || hostname === '[::1]') return true;
    return false;
  } catch {
    return false;
  }
}

function apiUrl(baseUrl: string, path: '/api/plan' | '/api/deny' | '/api/feedback'): string {
  const url = new URL(baseUrl);
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url: string, body: Record<string, unknown>): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMode(value: unknown): PlannotatorMode | undefined {
  if (value === 'plan' || value === 'review' || value === 'annotate' || value === 'archive') {
    return value;
  }
  return undefined;
}

function parseSessionInfo(raw: unknown): SessionInfo | null {
  if (!isRecord(raw)) return null;

  const pid = typeof raw.pid === 'number' && Number.isFinite(raw.pid) ? raw.pid : undefined;
  const port = typeof raw.port === 'number' && Number.isFinite(raw.port) ? raw.port : undefined;
  const url = typeof raw.url === 'string' ? raw.url : undefined;
  if (!pid || !url) return null;

  return {
    pid,
    port,
    url,
    mode: normalizeMode(raw.mode),
    project: typeof raw.project === 'string' ? raw.project : undefined,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    origin: typeof raw.origin === 'string' ? raw.origin : undefined,
    reviewId: typeof raw.reviewId === 'string' ? raw.reviewId : undefined,
    sourcePlanPath: typeof raw.sourcePlanPath === 'string' ? raw.sourcePlanPath : undefined,
  };
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function metadataRecord(metadata: PlannotatorMetadata): Record<string, unknown> {
  return {
    source: 'plannotator',
    sourceAdapter: 'plannotator',
    plannotator: metadata,
  };
}

function annotationsPathForSnapshot(filePath: string): string {
  const snapshotBase = basename(filePath, '.md').replace(/-(approved|denied)$/i, '');
  return join(dirname(filePath), `${snapshotBase}.annotations.md`);
}

function snapshotPathsForAnnotation(filePath: string): string[] {
  const base = basename(filePath, '.annotations.md');
  return [
    join(dirname(filePath), `${base}-approved.md`),
    join(dirname(filePath), `${base}-denied.md`),
  ];
}

function projectPlanPathsForAnnotation(filePath: string): string[] {
  const base = basename(filePath, '.annotations.md');
  return [join(dirname(filePath), `${base}.md`), ...snapshotPathsForAnnotation(filePath)];
}

async function countAnnotationHeadings(filePath: string): Promise<number | undefined> {
  if (!existsSync(filePath)) return undefined;
  try {
    const raw = await readFile(filePath, 'utf-8');
    const headings = raw.match(/^#{1,6}\s+/gm);
    return headings?.length ?? (raw.trim() ? 1 : 0);
  } catch {
    return undefined;
  }
}

async function parseSnapshot(filePath: string): Promise<Plan[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    const status = normalizeStatusFromFilename(filePath);
    const annotationsPath = annotationsPathForSnapshot(filePath);
    const annotationCount = await countAnnotationHeadings(annotationsPath);
    const metadata: PlannotatorMetadata = {
      kind: 'snapshot',
      mode: 'plan',
      status,
      annotationsPath: existsSync(annotationsPath) ? annotationsPath : undefined,
      annotationCount,
      writebackCapable: false,
    };

    return [
      {
        id: hashPath(filePath),
        agent: 'plannotator',
        title: extractTitle(content, filePath),
        content,
        filePath,
        format: 'md',
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
        metadata: metadataRecord(metadata),
      },
    ];
  } catch {
    return [];
  }
}

async function parseAnnotationCompanion(filePath: string): Promise<Plan[]> {
  const plans: Plan[] = [];
  for (const snapshotPath of snapshotPathsForAnnotation(filePath)) {
    if (!existsSync(snapshotPath)) continue;
    plans.push(...(await parseSnapshot(snapshotPath)));
  }
  return plans;
}

async function parseProjectPlan(filePath: string): Promise<Plan[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    const projectPlansDir = projectPlansDirForPath(filePath);
    const projectRoot = projectPlansDir ? dirname(projectPlansDir) : undefined;
    const status = normalizeStatusFromFilename(filePath);
    const annotationsPath = annotationsPathForSnapshot(filePath);
    const annotationCount = await countAnnotationHeadings(annotationsPath);
    const metadata: PlannotatorMetadata = {
      kind: 'project-plan',
      mode: 'plan',
      status,
      annotationsPath: existsSync(annotationsPath) ? annotationsPath : undefined,
      annotationCount,
      sourcePlanPath: filePath,
      project: projectRoot ? basename(projectRoot) : undefined,
      writebackCapable: false,
    };

    return [
      {
        id: hashPath(filePath),
        agent: 'plannotator',
        title: extractTitle(content, filePath),
        content,
        filePath,
        format: 'md',
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
        workspace: projectRoot,
        metadata: metadataRecord(metadata),
      },
    ];
  } catch {
    return [];
  }
}

async function parseProjectAnnotationCompanion(filePath: string): Promise<Plan[]> {
  const plans: Plan[] = [];
  const seen = new Set<string>();
  for (const planPath of projectPlanPathsForAnnotation(filePath)) {
    const resolved = resolve(planPath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!existsSync(planPath)) continue;
    plans.push(...(await parseProjectPlan(planPath)));
  }
  return plans;
}

async function parseLiveSession(filePath: string): Promise<Plan[]> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf-8')) as unknown;
    const session = parseSessionInfo(raw);
    if (!session?.pid || !session.url) return [];
    if (!isAlive(session.pid)) return [];
    if (!isSafePlannotatorUrl(session.url)) return [];

    const mode = session.mode ?? 'plan';
    if (mode === 'archive') return [];

    const planResponse = await fetchJson<PlanResponse>(apiUrl(session.url, '/api/plan'));
    if (!planResponse?.plan) return [];

    const stats = await stat(filePath);
    const createdAt = parseDate(session.startedAt) ?? stats.birthtime;
    const origin = planResponse.origin ?? session.origin;
    const responseMode = normalizeMode(planResponse.mode) ?? mode;
    const workspace = planResponse.projectRoot;
    const sourcePlanPath = session.sourcePlanPath ?? planResponse.filePath;

    const metadata: PlannotatorMetadata = {
      kind: 'live-session',
      mode: responseMode,
      status: 'pending',
      origin,
      url: session.url,
      pid: session.pid,
      port: session.port,
      project: session.project ?? planResponse.versionInfo?.project,
      label: session.label,
      reviewId: session.reviewId,
      sessionPath: filePath,
      sourcePlanPath,
      startedAt: session.startedAt,
      writebackCapable: true,
    };

    return [
      {
        id: hashPath(filePath),
        agent: origin ?? 'plannotator',
        title: extractTitle(planResponse.plan, session.label ?? filePath),
        content: planResponse.plan,
        filePath: sourcePlanPath ?? filePath,
        format: 'md',
        createdAt,
        updatedAt: stats.mtime,
        workspace,
        metadata: metadataRecord(metadata),
      },
    ];
  } catch {
    return [];
  }
}

function getPlannotatorMetadata(plan: Plan): PlannotatorMetadata | undefined {
  const metadata = plan.metadata.plannotator;
  if (!isRecord(metadata)) return undefined;
  return metadata as unknown as PlannotatorMetadata;
}

function formatWritebackFeedback(_plan: Plan, payload: PlannotatorWritebackPayload): string {
  const sections = ['# Agendex Plan Feedback', 'The user reviewed this plan in Agendex Cloud.'];

  if (payload.feedback.trim()) {
    sections.push('## Feedback', payload.feedback.trim());
  }

  if (payload.revisedContent?.trim()) {
    sections.push(
      '## Requested revision',
      'Use this revised plan content as the target shape when you update and resubmit the plan:',
      payload.revisedContent.trim(),
    );
  }

  if (payload.annotations?.length) {
    sections.push('## Typed annotations', JSON.stringify(payload.annotations, null, 2));
  }

  sections.push('Please revise the plan and resubmit it for Plannotator review.');
  return sections.join('\n\n');
}

function annotationsForEndpoint(
  annotations: PlannotatorFeedbackAnnotation[] | undefined,
): PlannotatorFeedbackAnnotation[] {
  return annotations ?? [];
}

export const plannotatorAdapter: AgentAdapter = {
  agent: 'plannotator',
  writable: false,

  getSearchPaths() {
    return [getPlansDir(), getSessionsDir()];
  },

  getWatchPaths() {
    return [getPlannotatorDir(), getPlansDir(), getSessionsDir()];
  },

  matches(filePath: string) {
    const normalized = resolve(filePath);
    const plansDir = resolve(getPlansDir());
    const sessionsDir = resolve(getSessionsDir());
    if (normalized.startsWith(plansDir + sep))
      return isSnapshotFile(filePath) || isAnnotationFile(filePath);
    if (normalized.startsWith(sessionsDir + sep)) return isSessionFile(filePath);
    if (isProjectPlansPath(filePath))
      return isProjectPlanFile(filePath) || isAnnotationFile(filePath);
    return false;
  },

  async parse(filePath: string): Promise<Plan[]> {
    const normalized = resolve(filePath);
    const plansDir = resolve(getPlansDir());
    const sessionsDir = resolve(getSessionsDir());
    if (normalized.startsWith(plansDir + sep) && isSnapshotFile(filePath)) {
      return await parseSnapshot(filePath);
    }
    if (normalized.startsWith(plansDir + sep) && isAnnotationFile(filePath)) {
      return await parseAnnotationCompanion(filePath);
    }
    if (normalized.startsWith(sessionsDir + sep) && isSessionFile(filePath)) {
      return await parseLiveSession(filePath);
    }
    if (isProjectPlanFile(filePath)) {
      return await parseProjectPlan(filePath);
    }
    if (isProjectPlansPath(filePath) && isAnnotationFile(filePath)) {
      return await parseProjectAnnotationCompanion(filePath);
    }
    return [];
  },

  async write(): Promise<boolean> {
    return false;
  },

  async requestChanges(plan: Plan, payload: PlannotatorWritebackPayload): Promise<boolean> {
    const metadata = getPlannotatorMetadata(plan);
    if (!metadata?.url || !metadata.writebackCapable) return false;
    if (!isSafePlannotatorUrl(metadata.url)) return false;

    const feedback = formatWritebackFeedback(plan, payload);
    if (metadata.mode === 'review' || metadata.mode === 'annotate') {
      return await postJson(apiUrl(metadata.url, '/api/feedback'), {
        feedback,
        annotations: annotationsForEndpoint(payload.annotations),
      });
    }

    return await postJson(apiUrl(metadata.url, '/api/deny'), {
      feedback,
      planSave: { enabled: true },
    });
  },
};
