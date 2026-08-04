import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CURRENT_CONFIG_VERSION,
  getAgentStats,
  createPlanAnnotation,
  deletePlanAnnotation,
  detectOpenInApps,
  getIndexableById,
  getIndexablePlans,
  isWithinWorkspace,
  listPlanAnnotations,
  loadConfig,
  normalizeCustomPlanDirs,
  PATH_EXISTS_BATCH_LIMIT,
  removeCustomPlanDir,
  resolveCodeFile,
  resolveCodeFileBatch,
  resolveCustomPlanDirPath,
  scan,
  startWatching,
  updateConfig,
  updatePlanAnnotationStatus,
  validatePlanAnnotationInput,
} from '@agendex/shared';
import { Hono } from 'hono';
import { launchOpenIn } from '../open-in.ts';
import { search } from '../services/search.ts';

const plans = new Hono();

plans.get('/plans', (c) => {
  const agent = c.req.query('agent');
  const q = c.req.query('q');
  const workspace = c.req.query('workspace');
  const sort = c.req.query('sort') ?? 'updatedAt';
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  let results = q ? search(q) : getIndexablePlans();

  if (agent) results = results.filter((p) => p.agent === agent);
  if (workspace) results = results.filter((p) => p.workspace?.includes(workspace));

  results.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'createdAt') return b.createdAt.getTime() - a.createdAt.getTime();
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const total = results.length;
  results = results.slice(offset, offset + limit);

  return c.json({ plans: results, total, limit, offset });
});

plans.get('/plans/:id', (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json(plan);
});

plans.get('/plans/:id/raw', (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.text(plan.content);
});

/** baseDir for ./ siblings: the plan file's parent, when inside the workspace. */
function planBaseDir(plan: { filePath: string; workspace?: string }): string | undefined {
  if (!plan.workspace || !plan.filePath) return undefined;
  const parent = dirname(plan.filePath);
  return isWithinWorkspace(parent, plan.workspace) ? parent : undefined;
}

/**
 * Cloud plans have Convex ids, while the local index derives ids from source
 * paths. Fall back through the source path, but only to an already-indexed
 * local plan so the browser can never nominate an arbitrary workspace root.
 */
function localPlanForPathAction(planId: string, sourceFilePath: unknown) {
  const direct = getIndexableById(planId);
  if (direct) return direct;
  if (typeof sourceFilePath !== 'string' || !sourceFilePath.trim()) return undefined;

  let requestedRealPath: string;
  try {
    requestedRealPath = realpathSync(sourceFilePath.trim());
  } catch {
    return undefined;
  }

  return getIndexablePlans().find((plan) => {
    try {
      return realpathSync(plan.filePath) === requestedRealPath;
    } catch {
      return false;
    }
  });
}

plans.post('/plans/:id/paths/exists', async (c) => {
  const body = await c.req.json<{ paths?: unknown; sourceFilePath?: unknown }>();
  if (!Array.isArray(body.paths)) {
    return c.json({ error: 'paths must be an array' }, 400);
  }
  const plan = localPlanForPathAction(c.req.param('id'), body.sourceFilePath);
  if (!plan) return c.json({ error: 'local plan source not found' }, 404);

  const paths: string[] = [];
  for (const path of body.paths) {
    if (paths.length >= PATH_EXISTS_BATCH_LIMIT) break;
    if (typeof path === 'string' && path.length > 0 && path.length <= 1024) paths.push(path);
  }

  const results = await resolveCodeFileBatch(paths, plan.workspace, planBaseDir(plan));
  return c.json({ results });
});

plans.get('/open-in/apps', (c) => {
  return c.json({ available: true, apps: detectOpenInApps() });
});

plans.post('/plans/:id/open-in', async (c) => {
  const body = await c.req.json<{
    path?: unknown;
    line?: unknown;
    appId?: unknown;
    sourceFilePath?: unknown;
  }>();
  const plan = localPlanForPathAction(c.req.param('id'), body.sourceFilePath);
  if (!plan) return c.json({ error: 'local plan source not found' }, 404);
  if (!plan.workspace) {
    return c.json({ error: 'This plan has no workspace, so paths cannot be opened.' }, 400);
  }

  if (typeof body.path !== 'string' || !body.path.trim()) {
    return c.json({ error: 'path is required' }, 400);
  }
  const line =
    typeof body.line === 'number' && Number.isInteger(body.line) && body.line > 0
      ? body.line
      : undefined;
  const appId = typeof body.appId === 'string' && body.appId.trim() ? body.appId : 'reveal';

  const resolved = await resolveCodeFile(body.path, plan.workspace, planBaseDir(plan));
  if (resolved.status === 'ambiguous') {
    return c.json({ error: 'path is ambiguous in this workspace', matches: resolved.matches }, 409);
  }
  if (resolved.status !== 'found') {
    return c.json({ error: 'path not found in this workspace' }, 404);
  }

  const result = await launchOpenIn(appId, resolved.resolved, line);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 502);
  return c.json({ ok: true });
});

plans.get('/plans/:id/annotations', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json({ annotations: await listPlanAnnotations(planId) });
});

plans.post('/plans/:id/annotations', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<{
    type?: 'comment' | 'replacement' | 'deletion' | 'insertion' | 'global_comment';
    status?: 'draft' | 'open' | 'submitted' | 'resolved';
    body?: string;
    replacementText?: string;
    anchor?: {
      quote?: string;
      startOffset?: number;
      endOffset?: number;
      occurrenceIndex?: number;
      prefix?: string;
      suffix?: string;
      contentHash?: string;
    };
  }>();

  if (
    body.type !== 'comment' &&
    body.type !== 'replacement' &&
    body.type !== 'deletion' &&
    body.type !== 'insertion' &&
    body.type !== 'global_comment'
  ) {
    return c.json({ error: 'invalid annotation type' }, 400);
  }

  const CREATE_VALID_STATUSES = new Set(['draft', 'open', 'resolved']);
  if (body.status !== undefined && !CREATE_VALID_STATUSES.has(body.status)) {
    return c.json({ error: 'invalid annotation status' }, 400);
  }

  const anchor = body.anchor ?? {};
  let validated: { body?: string; replacementText?: string };
  try {
    validated = validatePlanAnnotationInput({
      type: body.type,
      status: body.status,
      body: body.body,
      replacementText: body.replacementText,
      anchor,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'invalid annotation input' }, 400);
  }

  const annotation = await createPlanAnnotation(planId, {
    type: body.type,
    status: body.status ?? 'open',
    body: validated.body,
    replacementText: validated.replacementText,
    anchor,
    source: 'agendex-local',
  });

  return c.json(annotation, 201);
});

plans.patch('/plans/:id/annotations/:annotationId', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<{
    status?: 'draft' | 'open' | 'submitted' | 'resolved';
    writebackId?: string;
  }>();
  const VALID_STATUSES = new Set(['draft', 'open', 'submitted', 'resolved']);
  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return c.json({ error: 'invalid annotation status' }, 400);
  }

  const annotation = await updatePlanAnnotationStatus({
    planId,
    annotationId: c.req.param('annotationId'),
    status: body.status,
    writebackId: body.writebackId,
  });
  if (!annotation) return c.json({ error: 'annotation not found' }, 404);
  return c.json(annotation);
});

plans.delete('/plans/:id/annotations/:annotationId', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);
  const ok = await deletePlanAnnotation(planId, c.req.param('annotationId'));
  if (!ok) return c.json({ error: 'annotation not found' }, 404);
  return c.json({ ok: true });
});

plans.put('/plans/:id', (c) => {
  return c.json({ error: 'Plan editing requires Cloud Pro' }, 403);
});

plans.post('/plans', (c) => {
  return c.json({ error: 'Plan creation requires Cloud Pro' }, 403);
});

plans.get('/agents', (c) => {
  return c.json(getAgentStats());
});

plans.post('/rescan', async (c) => {
  await scan();
  return c.json({ ok: true });
});

// Custom plan directory management
let watcherOnChange: ((plans: unknown[]) => void) | undefined;

export function setPlanSourcesWatcherCallback(cb: (plans: unknown[]) => void) {
  watcherOnChange = cb;
}

plans.get('/plan-sources', (c) => {
  const config = loadConfig();
  return c.json({ customPlanDirs: config?.customPlanDirs ?? [] });
});

plans.post('/plan-sources', async (c) => {
  const body = await c.req.json<{ path?: string }>();
  if (typeof body.path !== 'string' || !body.path.trim()) {
    return c.json({ error: 'path is required' }, 400);
  }
  const requestedPath = body.path;
  const resolved = resolveCustomPlanDirPath(requestedPath);
  if (!existsSync(resolved)) {
    return c.json({ error: `path does not exist: ${resolved}` }, 400);
  }
  if (!statSync(resolved).isDirectory()) {
    return c.json({ error: `path is not a directory: ${resolved}` }, 400);
  }
  let updated: string[] = [];
  updateConfig((config) => {
    updated = normalizeCustomPlanDirs([...(config?.customPlanDirs ?? []), resolved]);
    return {
      ...(config ?? { configVersion: CURRENT_CONFIG_VERSION, enabledAdapters: [] }),
      customPlanDirs: updated,
    };
  });
  await scan();
  startWatching(watcherOnChange);
  return c.json({ customPlanDirs: updated });
});

plans.delete('/plan-sources', async (c) => {
  const body = await c.req.json<{ path?: string }>();
  if (typeof body.path !== 'string' || !body.path.trim()) {
    return c.json({ error: 'path is required' }, 400);
  }
  const requestedPath = body.path;
  const resolved = resolveCustomPlanDirPath(requestedPath);
  let updated: string[] | null = null;
  updateConfig((config) => {
    updated = removeCustomPlanDir(config?.customPlanDirs ?? [], requestedPath);
    if (updated === null) return null;
    return {
      ...(config ?? { configVersion: CURRENT_CONFIG_VERSION, enabledAdapters: [] }),
      customPlanDirs: updated,
    };
  });
  if (updated === null) {
    return c.json({ error: `path not in custom plan sources: ${resolved}` }, 404);
  }
  await scan();
  startWatching(watcherOnChange);
  return c.json({ customPlanDirs: updated });
});

export { plans };
