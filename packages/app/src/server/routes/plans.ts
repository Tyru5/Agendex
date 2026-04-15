import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getAgentStats,
  getAll,
  getById,
  loadConfig,
  normalizeCustomPlanDirs,
  refreshWatching,
  saveConfig,
  scan,
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

  let results = q ? search(q) : getAll();

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
  const plan = getById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json(plan);
});

plans.get('/plans/:id/raw', (c) => {
  const plan = getById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.text(plan.content);
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
  if (!body.path || typeof body.path !== 'string') {
    return c.json({ error: 'path is required' }, 400);
  }
  const resolved = resolve(body.path);
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
  refreshWatching(watcherOnChange);
  return c.json({ customPlanDirs: updated });
});

plans.delete('/plan-sources', async (c) => {
  const body = await c.req.json<{ path?: string }>();
  if (!body.path || typeof body.path !== 'string') {
    return c.json({ error: 'path is required' }, 400);
  }
  const resolved = resolve(body.path);
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
  refreshWatching(watcherOnChange);
  return c.json({ customPlanDirs: updated });
});

export { plans };
