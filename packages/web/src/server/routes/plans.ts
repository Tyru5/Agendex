import { create, getAgentStats, getAll, getById, scan, update } from '@agendex/shared';
import { Hono } from 'hono';
import { search } from '../services/search.ts';

const plans = new Hono();

plans.get('/health', (c) => {
  return c.json({ ok: true });
});

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

plans.put('/plans/:id', async (c) => {
  const plan = getById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<{ content: string }>();
  if (!body.content) return c.json({ error: 'content required' }, 400);

  const ok = await update(plan.id, body.content);
  if (!ok) return c.json({ error: 'not writable' }, 403);

  return c.json({ ok: true });
});

plans.post('/plans', async (c) => {
  const body = await c.req.json<{ agent: string; title: string; content: string }>();
  if (!body.agent || !body.title || !body.content) {
    return c.json({ error: 'agent, title, and content are required' }, 400);
  }
  try {
    const plan = await create(body.agent, body.title, body.content);
    return c.json(plan, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 500);
  }
});

plans.get('/agents', (c) => {
  return c.json(getAgentStats());
});

plans.post('/rescan', async (c) => {
  await scan();
  return c.json({ ok: true });
});

export { plans };
