import { Hono, type Context } from 'hono';
import { ApprovalError, ApprovalSessions } from '../approval-sessions.ts';

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApprovalError('Invalid review request', 400);
  }
  return body as Record<string, unknown>;
}

export function createApprovalRoutes(store = new ApprovalSessions()) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof ApprovalError) return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid review request' }, 400);
    console.error('[agendex] review route failed:', error);
    return c.json({ error: 'Internal error' }, 500);
  });
  app.get('/review-sessions', (c) => c.json({ sessions: store.list() }));
  app.post('/review-sessions', async (c) => c.json(store.create(await readBody(c)), 201));
  app.post('/review-sessions/:id/heartbeat', async (c) => {
    const body = await readBody(c);
    return c.json(store.heartbeat(c.req.param('id'), body.ownerKey, body.revision));
  });
  app.post('/review-sessions/:id/decision', async (c) => {
    const body = await readBody(c);
    return c.json(store.decide(c.req.param('id'), body.revision, body.decision, body.feedback));
  });
  app.post('/review-sessions/:id/cancel', async (c) => {
    const body = await readBody(c);
    return c.json(store.cancel(c.req.param('id'), body.ownerKey));
  });
  app.post('/review-sessions/:id/ack', async (c) => {
    const body = await readBody(c);
    return c.json(store.acknowledge(c.req.param('id'), body.ownerKey, body.revision));
  });
  return app;
}
export const approvals = createApprovalRoutes();
