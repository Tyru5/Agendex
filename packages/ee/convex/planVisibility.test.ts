import { expect, test } from 'bun:test';
import { assessPlanValue } from '@agendex/shared/plan-value';
import {
  assessPlanForVisibility,
  dedupeVisiblePlans,
  filterVisiblePlans,
  hasLowValueMetadata,
  isVisiblePlan,
  mergePlanMetadata,
  metadataWithPlanValueAssessment,
} from './planVisibility';

test('mergePlanMetadata clears stale lowValue when incoming metadata is missing', () => {
  const merged = mergePlanMetadata({ lowValue: true, deviceId: 'dev-1' }, undefined);
  expect(merged).toEqual({ deviceId: 'dev-1' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});

test('mergePlanMetadata clears stale lowValue when incoming metadata is not an object', () => {
  const merged = mergePlanMetadata({ lowValue: true, hostname: 'laptop' }, 'invalid');
  expect(merged).toEqual({ hostname: 'laptop' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});

test('mergePlanMetadata clears stale lowValue when incoming object omits low-value fields', () => {
  const merged = mergePlanMetadata({ lowValue: true, deviceId: 'dev-1' }, { deviceId: 'dev-2' });
  expect(merged).toEqual({ deviceId: 'dev-2' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});

test('mergePlanMetadata preserves explicit lowValue on incoming object metadata', () => {
  const merged = mergePlanMetadata(
    { deviceId: 'dev-1' },
    { lowValue: true, lowValueReasons: ['heading-only'] },
  );
  expect(merged).toEqual({ deviceId: 'dev-1', lowValue: true, lowValueReasons: ['heading-only'] });
  expect(hasLowValueMetadata(merged)).toBe(true);
});

test('mergePlanMetadata clears stale lowValue even when incoming metadata is userCreated', () => {
  const merged = mergePlanMetadata(
    { lowValue: true, deviceId: 'dev-1' },
    { userCreated: true, title: 'My plan' },
  );
  expect(merged).toEqual({ deviceId: 'dev-1', userCreated: true, title: 'My plan' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});

const cases = [
  {
    name: 'empty content',
    plan: { title: 'Empty', content: '---\nagent: test\n---\n<!-- only comment -->' },
  },
  {
    name: 'heading only custom dir',
    plan: {
      title: 'Heading Only',
      content: '# Heading Only\n',
      metadata: { source: 'custom-dir' },
    },
  },
  {
    name: 'code only user-created',
    plan: {
      title: 'Helper',
      content: '```ts\nexport const x = 1;\n```',
      metadata: { userCreated: true },
    },
  },
  {
    name: 'prompt only',
    plan: { title: 'Please fix login', content: 'Please fix login' },
  },
  {
    name: 'structured plan',
    plan: {
      title: 'Plan',
      content:
        '# Plan\n\n## Approach\nAdd validation.\n\n## Steps\n- [ ] Implement helper\n- [ ] Add tests\n',
    },
  },
  {
    name: 'short checklist',
    plan: { title: 'Checklist', content: '- [ ] Fix login bug' },
  },
] as const;

test('Convex visibility classifier stays in parity with shared plan-value classifier', () => {
  for (const { plan } of cases) {
    const metadata = 'metadata' in plan ? plan.metadata : undefined;
    expect(assessPlanForVisibility(plan).lowValue).toBe(
      assessPlanValue({ title: plan.title, content: plan.content, metadata }).lowValue,
    );
  }
});

test('custom-dir and user-created metadata do not bypass visibility classification', () => {
  expect(
    isVisiblePlan({
      title: 'Heading Only',
      content: '# Heading Only\n',
      metadata: { source: 'custom-dir' },
    }),
  ).toBe(false);

  expect(
    isVisiblePlan({
      title: 'Helper',
      content: '```ts\nexport const x = 1;\n```',
      metadata: { userCreated: true },
    }),
  ).toBe(false);
});

test('filterVisiblePlans trusts the persisted low-value flag and skips live classification', () => {
  const plans = [
    // Persisted low-value flag -> hidden.
    { title: 'Junk', content: '# x', metadata: { lowValue: true, lowValueReasons: ['code-only'] } },
    // No persisted flag -> kept, even though the content alone would classify as
    // low value. Collection reads rely on the flag being kept fresh at write
    // time and by `backfillPlanValueMetadata`, not on per-plan classification.
    {
      title: 'Helper',
      content: '```ts\nexport const x = 1;\n```',
      metadata: { userCreated: true },
    },
    // Valuable plan with no flag -> kept.
    {
      title: 'Plan',
      content: '# Plan\n\n## Approach\nAdd validation.\n\n## Steps\n- [ ] Implement helper\n',
    },
  ];

  const visible = filterVisiblePlans(plans);
  expect(visible.map((p) => p.title)).toEqual(['Helper', 'Plan']);
});

test('dedupeVisiblePlans keeps the newest canonical row per sync identity', () => {
  const visible = dedupeVisiblePlans([
    {
      _creationTime: 1,
      agent: 'cursor',
      title: 'Plan',
      content: 'old',
      metadata: {},
      updatedAt: 10,
      syncIdentityKey: 'v1:cursor:path:plan.md',
    },
    {
      _creationTime: 2,
      agent: 'cursor',
      title: 'Plan',
      content: 'new',
      metadata: {},
      updatedAt: 20,
      syncIdentityKey: 'v1:cursor:path:plan.md',
    },
    {
      _creationTime: 3,
      agent: 'cursor',
      title: 'Other',
      content: 'other',
      metadata: {},
      updatedAt: 5,
    },
  ]);

  expect(visible.map((plan) => plan.content)).toEqual(['new', 'other']);
});

test('dedupeVisiblePlans falls back to exact content hash grouping', () => {
  const visible = dedupeVisiblePlans([
    {
      _creationTime: 1,
      agent: 'uploaded',
      title: 'Same Plan',
      content: 'a',
      metadata: {},
      updatedAt: 10,
      contentHash: 'hash-1',
    },
    {
      _creationTime: 2,
      agent: 'uploaded',
      title: '  Same   Plan  ',
      content: 'a',
      metadata: {},
      updatedAt: 10,
      contentHash: 'hash-1',
    },
  ]);

  expect(visible).toHaveLength(1);
  expect(visible[0]?.title).toBe('  Same   Plan  ');
});

test('metadataWithPlanValueAssessment annotates low-value and removes stale keys from valuable plans', () => {
  const lowValue = metadataWithPlanValueAssessment(
    { source: 'custom-dir' },
    { title: 'Helper', content: '```ts\nexport const x = 1;\n```' },
  );
  expect(lowValue?.lowValue).toBe(true);
  expect(lowValue?.lowValueReasons).toContain('code-only');

  const valuable = metadataWithPlanValueAssessment(
    { source: 'custom-dir', lowValue: true, lowValueReasons: ['code-only'] },
    {
      title: 'Plan',
      content: '# Plan\n\n## Approach\nAdd validation.\n\n## Steps\n- [ ] Implement helper\n',
    },
  );
  expect(valuable).toEqual({ source: 'custom-dir' });
});
