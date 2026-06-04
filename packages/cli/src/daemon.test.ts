import { expect, test } from 'bun:test';
import type { SyncPlanPayload } from './api.ts';
import { buildEndedPlannotatorPayload, isLivePlannotatorPayload } from './daemon.ts';

function payload(overrides: Partial<SyncPlanPayload> = {}): SyncPlanPayload {
  return {
    localPlanId: 'plan-1',
    agent: 'plannotator',
    title: 'Live plan',
    content: '# Plan',
    format: 'md',
    ...overrides,
  };
}

test('isLivePlannotatorPayload only matches writeback-capable live sessions', () => {
  expect(
    isLivePlannotatorPayload(
      payload({
        metadata: { plannotator: { kind: 'live-session', writebackCapable: true } },
      }),
    ),
  ).toBe(true);

  // Snapshot / project-plan kinds are never live.
  expect(
    isLivePlannotatorPayload(
      payload({ metadata: { plannotator: { kind: 'snapshot', writebackCapable: true } } }),
    ),
  ).toBe(false);

  // Live session that is not writeback-capable (already ended) is not live.
  expect(
    isLivePlannotatorPayload(
      payload({ metadata: { plannotator: { kind: 'live-session', writebackCapable: false } } }),
    ),
  ).toBe(false);

  // No Plannotator metadata at all.
  expect(isLivePlannotatorPayload(payload())).toBe(false);
});

test('buildEndedPlannotatorPayload flips liveness while preserving identity and content', () => {
  const original = payload({
    content: '# Original content',
    workspace: '/repo',
    metadata: {
      lowValue: false,
      plannotator: {
        kind: 'live-session',
        writebackCapable: true,
        liveness: 'live',
        url: 'http://localhost:7531',
        pid: 4242,
      },
    },
  });

  const ended = buildEndedPlannotatorPayload(original);

  // Identity + content are preserved so the cloud copy keeps the plan.
  expect(ended.localPlanId).toBe(original.localPlanId);
  expect(ended.content).toBe(original.content);
  expect(ended.workspace).toBe('/repo');

  const endedMeta = ended.metadata as Record<string, unknown>;
  const plannotator = endedMeta.plannotator as Record<string, unknown>;
  expect(plannotator.writebackCapable).toBe(false);
  expect(plannotator.liveness).toBe('ended');
  expect(typeof plannotator.endedAt).toBe('number');
  // Unrelated metadata and plannotator fields are retained.
  expect(endedMeta.lowValue).toBe(false);
  expect(plannotator.url).toBe('http://localhost:7531');

  // After flipping, it must no longer be considered live.
  expect(isLivePlannotatorPayload(ended)).toBe(false);

  // Original payload is not mutated.
  const originalPlannotator = (original.metadata as Record<string, unknown>).plannotator as Record<
    string,
    unknown
  >;
  expect(originalPlannotator.writebackCapable).toBe(true);
  expect(originalPlannotator.liveness).toBe('live');
});
