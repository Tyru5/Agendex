import { expect, test } from 'bun:test';
import { ApprovalSessions, planRevision } from './approval-sessions.ts';
import { createApprovalRoutes } from './routes/approvals.ts';
import { Hono } from 'hono';
const ownerKey = 'a'.repeat(64);
const input = {
  id: 'test-request',
  agent: 'claude-code',
  agentSessionId: 'claude-session',
  ownerKey,
  title: 'Implement auth',
  content: '# Auth\nImplement authorization',
  timeoutMs: 120000,
};
test('pending decisions are immutable, authenticated by owner at delivery, and ack idempotent', () => {
  for (const decision of ['approved', 'changes_requested', 'rejected']) {
    const store = new ApprovalSessions();
    const row = store.create(input);
    expect(row.status).toBe('pending');
    expect(row.revision).toBe(planRevision(input.content));
    const feedback = decision === 'approved' ? undefined : 'Please revise auth';
    expect(store.decide(row.id, row.revision, decision, feedback).reviewedBy).toBe('local-token');
    expect(store.decide(row.id, row.revision, decision, feedback).status).toBe(decision);
    expect(() => store.decide(row.id, row.revision, 'approved', 'Different decision')).toThrow(
      'no longer pending',
    );
    expect(() => store.heartbeat(row.id, 'b'.repeat(64), row.revision)).toThrow('owner');
    expect(() => store.acknowledge(row.id, 'b'.repeat(64), row.revision)).toThrow('owner');
    const ack = store.acknowledge(row.id, ownerKey, row.revision);
    expect(ack.status).toBe(decision);
    expect(store.acknowledge(row.id, ownerKey, row.revision).acknowledgedAt).toBe(
      ack.acknowledgedAt,
    );
    expect(() => store.cancel(row.id)).toThrow('already acknowledged');
  }
});
test('edited revisions can never consume approval', () => {
  const store = new ApprovalSessions();
  const row = store.create(input);
  expect(() => store.decide(row.id, 'wrong', 'approved', undefined)).toThrow('revision');
  store.decide(row.id, row.revision, 'approved', undefined);
  expect(store.heartbeat(row.id, ownerKey, planRevision('edited plan')).status).toBe('superseded');
  expect(() => store.acknowledge(row.id, ownerKey, row.revision)).toThrow('No live decision');
});
test('changes at final ack invalidate granted decision', () => {
  const store = new ApprovalSessions();
  const row = store.create(input);
  store.decide(row.id, row.revision, 'approved', undefined);
  expect(() => store.acknowledge(row.id, ownerKey, 'edited')).toThrow('Revision changed');
  expect(store.list()[0]?.status).toBe('superseded');
});
test('timeout and killed owner disconnect revoke pending and undelivered grants', () => {
  for (const status of ['pending', 'approved']) {
    let now = 100;
    const store = new ApprovalSessions(() => now);
    const row = store.create(input);
    if (status === 'approved') store.decide(row.id, row.revision, status, undefined);
    now += 60000;
    expect(store.heartbeat(row.id, ownerKey, row.revision).status).toBe('disconnected');
    expect(() => store.acknowledge(row.id, ownerKey, row.revision)).toThrow('No live decision');
  }
  let now = 100;
  const store = new ApprovalSessions(() => now);
  const row = store.create({ ...input, timeoutMs: 1000 });
  now += 1000;
  expect(store.heartbeat(row.id, ownerKey, row.revision).status).toBe('expired');
});
test('duplicate creation cannot claim another owner/session/revision and never recreates terminal session', () => {
  const store = new ApprovalSessions();
  const row = store.create(input);
  expect(store.create(input).id).toBe(row.id);
  expect(() => store.create({ ...input, ownerKey: 'b'.repeat(64) })).toThrow('owner');
  expect(() => store.create({ ...input, agentSessionId: 'other' })).toThrow('another request');
  expect(() => store.create({ ...input, content: 'other' })).toThrow('another request');
  store.cancel(row.id, ownerKey);
  expect(store.create(input).status).toBe('cancelled');
  expect(() => store.decide(row.id, row.revision, 'approved', undefined)).toThrow(
    'no longer pending',
  );
});
test('invalid inputs, required feedback, and bounded queue', () => {
  const store = new ApprovalSessions();
  expect(() => store.create({ ...input, content: '' })).toThrow('Invalid');
  expect(() => store.create({ ...input, timeoutMs: 3600001 })).toThrow('Invalid');
  const row = store.create(input);
  expect(() => store.decide(row.id, row.revision, 'changes_requested', '')).toThrow('Feedback');
  expect(() => store.decide(row.id, row.revision, 'hacked', undefined)).toThrow('Invalid');
  for (let i = 1; i < 200; i++) store.create({ ...input, id: `request-${i}` });
  expect(() => store.create({ ...input, id: 'full' })).toThrow('full');
  expect(JSON.stringify(store.list())).not.toContain(ownerKey);
});
test('API authentication protects reviewer decision, list and owner routes', async () => {
  const store = new ApprovalSessions();
  const row = store.create(input);
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (c.req.header('Authorization') !== 'Bearer local-test')
      return c.json({ error: 'unauthorized' }, 401);
    await next();
  });
  app.route('/api/v1', createApprovalRoutes(store));
  expect((await app.request('/api/v1/review-sessions')).status).toBe(401);
  expect(
    (
      await app.request(`/api/v1/review-sessions/${row.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ revision: row.revision, decision: 'approved' }),
      })
    ).status,
  ).toBe(401);
  expect(store.list()[0]?.status).toBe('pending');
  const res = await app.request(`/api/v1/review-sessions/${row.id}/decision`, {
    method: 'POST',
    headers: { Authorization: 'Bearer local-test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: row.revision, decision: 'approved' }),
  });
  expect(res.status).toBe(200);
  expect((await res.json()).status).toBe('approved');
});
