import { existsSync, statSync } from 'node:fs';
import {
  getAgentStats,
  createPlanAnnotation,
  deletePlanAnnotation,
  getIndexableById,
  getIndexablePlans,
  listPlanAnnotations,
  loadConfig,
  normalizeCustomPlanDirs,
  resolveCustomPlanDirPath,
  saveConfig,
  scan,
  startWatching,
  updatePlanAnnotationStatus,
} from '@agendex/shared';
import { Hono } from 'hono';
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

  const annotationBody = body.body?.trim() || undefined;
  const replacementText = body.replacementText?.trim() || undefined;

  if ((body.type === 'comment' || body.type === 'global_comment') && !annotationBody) {
    return c.json({ error: 'Annotation feedback is required' }, 400);
  }

  if ((body.type === 'replacement' || body.type === 'insertion') && !replacementText) {
    return c.json({ error: 'Suggested replacement text is required' }, 400);
  }

  const CREATE_VALID_STATUSES = new Set(['draft', 'open', 'resolved']);
  if (body.status !== undefined && !CREATE_VALID_STATUSES.has(body.status)) {
    return c.json({ error: 'invalid annotation status' }, 400);
  }

  const annotation = await createPlanAnnotation(planId, {
    type: body.type,
    status: body.status ?? 'open',
    body: annotationBody,
    replacementText,
    anchor: body.anchor ?? {},
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
  const resolved = resolveCustomPlanDirPath(body.path);
  if (!existsSync(resolved)) {
    return c.json({ error: `path does not exist: ${resolved}` }, 400);
  }
  if (!statSync(resolved).isDirectory()) {
    return c.json({ error: `path is not a directory: ${resolved}` }, 400);
  }
  const config = loadConfig();
  const currentDirs = config?.customPlanDirs ?? [];
  const updated = normalizeCustomPlanDirs([...currentDirs, resolved]);
  saveConfig({
    ...(config ?? { configVersion: 3, enabledAdapters: [] }),
    customPlanDirs: updated,
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
  const resolved = resolveCustomPlanDirPath(body.path);
  const config = loadConfig();
  const currentDirs = config?.customPlanDirs ?? [];
  const updated = currentDirs.filter((d) => d !== resolved);
  if (updated.length === currentDirs.length) {
    return c.json({ error: `directory not in custom plan dirs: ${resolved}` }, 404);
  }
  saveConfig({
    ...(config ?? { configVersion: 3, enabledAdapters: [] }),
    customPlanDirs: updated,
  });
  await scan();
  startWatching(watcherOnChange);
  return c.json({ customPlanDirs: updated });
});

export { plans };
