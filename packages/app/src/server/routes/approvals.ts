import { Hono } from 'hono';
import { ApprovalError, ApprovalSessions } from '../approval-sessions.ts';

export function createApprovalRoutes(store = new ApprovalSessions()) {
  const app = new Hono();
  app.onError((error, c) =>
    error instanceof ApprovalError
      ? c.json({ error: error.message }, error.status)
      : c.json({ error: 'Invalid review request' }, 400),
  );
  app.get('/review-sessions', (c) => c.json({ sessions: store.list() }));
  app.post('/review-sessions', async (c) => c.json(store.create(await c.req.json()), 201));
  app.post('/review-sessions/:id/heartbeat', async (c) => {
    const body = await c.req.json();
    return c.json(store.heartbeat(c.req.param('id'), body.ownerKey, body.revision));
  });
  app.post('/review-sessions/:id/decision', async (c) => {
    const body = await c.req.json();
    return c.json(store.decide(c.req.param('id'), body.revision, body.decision, body.feedback));
  });
  app.post('/review-sessions/:id/cancel', async (c) => {
    const body = await c.req.json();
    return c.json(store.cancel(c.req.param('id'), body.ownerKey));
  });
  app.post('/review-sessions/:id/ack', async (c) => {
    const body = await c.req.json();
    return c.json(store.acknowledge(c.req.param('id'), body.ownerKey, body.revision));
  });
  return app;
}
export const approvals = createApprovalRoutes();
