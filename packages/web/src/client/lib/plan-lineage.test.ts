import { expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import { extractLineageKeys, getRelatedPlans, plansWithSessionSiblings } from './plan-lineage.ts';

function makePlan(overrides: Partial<Plan> & { id: string }): Plan {
  return {
    agent: 'cursor',
    title: overrides.title ?? overrides.id,
    content: '',
    filePath: `/tmp/${overrides.id}.md`,
    format: 'md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

test('extractLineageKeys reads sessionId parentThreadId and branch', () => {
  const plan = makePlan({
    id: 'a',
    metadata: { sessionId: ' sess-1 ', parentThreadId: 'parent-1', branch: 'feat/x' },
  });
  expect(extractLineageKeys(plan)).toEqual({
    sessionId: 'sess-1',
    parentThreadId: 'parent-1',
    branch: 'feat/x',
  });
});

test('getRelatedPlans groups same-session peers chronologically and marks self', () => {
  const plans = [
    makePlan({
      id: 'early',
      title: 'First',
      createdAt: '2026-03-01T10:00:00.000Z',
      metadata: { sessionId: 's1' },
    }),
    makePlan({
      id: 'mid',
      title: 'Current',
      createdAt: '2026-03-01T11:00:00.000Z',
      metadata: { sessionId: 's1' },
    }),
    makePlan({
      id: 'late',
      title: 'Later',
      createdAt: '2026-03-01T12:00:00.000Z',
      metadata: { sessionId: 's1' },
    }),
    makePlan({
      id: 'other',
      title: 'Other session',
      metadata: { sessionId: 's2' },
    }),
  ];

  const current = plans[1];
  expect(current).toBeDefined();
  if (!current) throw new Error('expected current plan');
  const lineage = getRelatedPlans(current, plans);
  expect(lineage.hasRelated).toBe(true);
  expect(lineage.peers.map((e) => e.plan.id)).toEqual(['early', 'late']);
  expect(lineage.items.map((e) => e.plan.id)).toEqual(['early', 'mid', 'late']);
  expect(lineage.items.map((e) => e.relation)).toEqual(['peer', 'self', 'peer']);
  expect(lineage.items.every((e) => e.confidence === 'session')).toBe(true);
});

test('getRelatedPlans links parent and children via parentThreadId', () => {
  const parent = makePlan({
    id: 'parent',
    agent: 'codex-cli',
    createdAt: '2026-03-01T09:00:00.000Z',
    metadata: { sessionId: 'parent-thread' },
  });
  const child = makePlan({
    id: 'child',
    agent: 'codex-cli',
    createdAt: '2026-03-01T10:00:00.000Z',
    metadata: { sessionId: 'child-thread', parentThreadId: 'parent-thread' },
  });
  const sibling = makePlan({
    id: 'sibling',
    agent: 'codex-cli',
    createdAt: '2026-03-01T11:00:00.000Z',
    metadata: { sessionId: 'child-thread', parentThreadId: 'parent-thread' },
  });

  const fromChild = getRelatedPlans(child, [parent, child, sibling]);
  expect(fromChild.parent?.plan.id).toBe('parent');
  expect(fromChild.parent?.confidence).toBe('thread');
  expect(fromChild.peers.map((e) => e.plan.id)).toEqual(['sibling']);

  const fromParent = getRelatedPlans(parent, [parent, child, sibling]);
  expect(fromParent.children.map((e) => e.plan.id).sort()).toEqual(['child', 'sibling']);
  expect(fromParent.children.every((e) => e.confidence === 'thread')).toBe(true);
});

test('getRelatedPlans falls back to workspace agent day or branch when session missing', () => {
  const current = makePlan({
    id: 'a',
    agent: 'grok',
    workspace: '/repo',
    createdAt: '2026-04-02T08:00:00.000Z',
    updatedAt: '2026-04-02T09:00:00.000Z',
    metadata: { branch: 'main' },
  });
  const sameDay = makePlan({
    id: 'b',
    agent: 'grok',
    workspace: '/repo',
    createdAt: '2026-04-02T14:00:00.000Z',
    metadata: {},
  });
  const sameBranch = makePlan({
    id: 'c',
    agent: 'grok',
    workspace: '/repo',
    createdAt: '2026-04-10T14:00:00.000Z',
    metadata: { branch: 'main' },
  });
  const otherAgent = makePlan({
    id: 'd',
    agent: 'cursor',
    workspace: '/repo',
    createdAt: '2026-04-02T14:00:00.000Z',
    metadata: {},
  });
  const otherWorkspace = makePlan({
    id: 'e',
    agent: 'grok',
    workspace: '/other',
    createdAt: '2026-04-02T14:00:00.000Z',
    metadata: {},
  });
  const withSession = makePlan({
    id: 'f',
    agent: 'grok',
    workspace: '/repo',
    createdAt: '2026-04-02T14:00:00.000Z',
    metadata: { sessionId: 'elsewhere' },
  });

  const lineage = getRelatedPlans(current, [
    current,
    sameDay,
    sameBranch,
    otherAgent,
    otherWorkspace,
    withSession,
  ]);
  expect(lineage.hasRelated).toBe(true);
  expect(lineage.peers.map((e) => e.plan.id).sort()).toEqual(['b', 'c']);
  expect(lineage.peers.every((e) => e.confidence === 'workspace-fallback')).toBe(true);
});

test('getRelatedPlans returns no related when nothing matches', () => {
  const plan = makePlan({ id: 'solo', metadata: { sessionId: 'only-me' } });
  const other = makePlan({ id: 'other', metadata: { sessionId: 'different' } });
  const lineage = getRelatedPlans(plan, [plan, other]);
  expect(lineage.hasRelated).toBe(false);
  expect(lineage.items).toHaveLength(1);
  expect(lineage.items[0]?.relation).toBe('self');
});

test('plansWithSessionSiblings marks only plans that share a session', () => {
  const plans = [
    makePlan({ id: 'a', metadata: { sessionId: 's1' } }),
    makePlan({ id: 'b', metadata: { sessionId: 's1' } }),
    makePlan({ id: 'c', metadata: { sessionId: 's2' } }),
    makePlan({ id: 'd', metadata: {} }),
    makePlan({ id: 'e', agent: 'grok', metadata: { sessionId: 's1' } }),
  ];
  const ids = plansWithSessionSiblings(plans);
  expect([...ids].sort()).toEqual(['a', 'b']);
});
