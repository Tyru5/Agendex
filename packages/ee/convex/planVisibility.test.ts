import { expect, test } from 'bun:test';
import { assessPlanValue } from '@agendex/shared/plan-value';
import {
  assessPlanForVisibility,
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
