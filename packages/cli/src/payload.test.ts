import { expect, test } from 'bun:test';
import { hashPath, type Plan } from '@agendex/shared';
import { fileToSyncPayload, parseUploadFile, planToSyncPayload } from './payload.ts';

test('planToSyncPayload preserves metadata and records the syncing daemon device', () => {
  const plan: Plan = {
    id: 'local-1',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: {
      source: 'plannotator',
      agendexSync: { previous: true },
    },
  };

  const payload = planToSyncPayload(plan, 'device-1', 'my-laptop', '192.168.1.42');

  expect(payload.metadata).toEqual({
    source: 'plannotator',
    agendexSync: {
      previous: true,
      deviceId: 'device-1',
      hostname: 'my-laptop',
      ipAddress: '192.168.1.42',
    },
  });
  expect(plan.metadata).toEqual({
    source: 'plannotator',
    agendexSync: { previous: true },
  });
});

test('planToSyncPayload omits sync metadata when no provenance fields provided', () => {
  const plan: Plan = {
    id: 'local-2',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: { source: 'plannotator' },
  };

  const payload = planToSyncPayload(plan);

  expect(payload.metadata).toEqual({ source: 'plannotator' });
});

test('planToSyncPayload records ipAddress even when hostname/deviceId are absent', () => {
  const plan: Plan = {
    id: 'local-3',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: {},
  };

  const payload = planToSyncPayload(plan, undefined, undefined, '10.0.0.5');

  expect(payload.metadata).toEqual({
    agendexSync: { ipAddress: '10.0.0.5' },
  });
});

test('parseUploadFile derives title from first heading', () => {
  const r = parseUploadFile('/tmp/my-plan.md', '# Real Title\n\nBody text');
  expect(r.title).toBe('Real Title');
  expect(r.body).toBe('# Real Title\n\nBody text');
});

test('parseUploadFile falls back to filename when no heading', () => {
  const r = parseUploadFile('/tmp/my-plan.md', 'Just some body without heading');
  expect(r.title).toBe('my-plan');
});

test('parseUploadFile reads agent from frontmatter and strips it from body', () => {
  const content = '---\nagent: codex\n---\n# Titled\n\nBody';
  const r = parseUploadFile('/tmp/p.md', content);
  expect(r.agent).toBe('codex');
  expect(r.title).toBe('Titled');
  expect(r.body).toBe('# Titled\n\nBody');
});

test('parseUploadFile prefers frontmatter agent over override', () => {
  const content = '---\nagent: codex\n---\n# Titled';
  const r = parseUploadFile('/tmp/p.md', content, 'cursor');
  expect(r.agent).toBe('codex');
});

test('parseUploadFile uses agent override when no frontmatter', () => {
  const r = parseUploadFile('/tmp/p.md', '# Titled', 'cursor');
  expect(r.agent).toBe('cursor');
});

test("parseUploadFile defaults agent to 'uploaded'", () => {
  const r = parseUploadFile('/tmp/p.md', '# Titled');
  expect(r.agent).toBe('uploaded');
});

test('fileToSyncPayload derives localPlanId from absolute path hash', () => {
  const payload = fileToSyncPayload('/tmp/abs/plan.md', '# Plan\n\nbody', {
    createdAt: 100,
    updatedAt: 200,
  });
  expect(payload.localPlanId).toBe(hashPath('/tmp/abs/plan.md'));
  expect(payload.format).toBe('md');
  expect(payload.title).toBe('Plan');
  expect(payload.content).toBe('# Plan\n\nbody');
  expect(payload.createdAt).toBe(100);
  expect(payload.updatedAt).toBe(200);
  expect(payload.filePath).toBe('/tmp/abs/plan.md');
});

test('fileToSyncPayload records upload provenance metadata', () => {
  const payload = fileToSyncPayload('/tmp/abs/plan.md', '# Plan', {
    deviceId: 'dev-1',
    hostname: 'box',
  });
  expect(payload.metadata).toEqual({
    uploaded: true,
    agendexSync: { deviceId: 'dev-1', hostname: 'box' },
  });
});
