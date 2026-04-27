import { expect, test } from 'bun:test';
import type { Plan } from '../types.ts';
import { annotatePlanValueMetadata, assessPlanValue } from './plan-value.ts';

test('marks empty content as low-value', () => {
  const assessment = assessPlanValue({
    content: '---\nagent: test\n---\n<!-- cursor -->\n\n   ',
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('empty-content');
});

test('marks heading-only content as low-value', () => {
  const assessment = assessPlanValue({ content: '# Plan\n\n## Context\n' });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('heading-only');
});

test('marks one-line user prompts as low-value', () => {
  const assessment = assessPlanValue({
    content:
      'IMPORTANT: Work in the repository "tyru5/agendex" on the existing branch "feat/plannotator-integration".',
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('prompt-like');
});

test('does not treat a one-line prompt starting with plan as a plan section', () => {
  const assessment = assessPlanValue({ content: 'Plan to fix the login bug' });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('prompt-like');
});

test('marks system context or model thought wrappers as low-value', () => {
  const assessment = assessPlanValue({
    content:
      '<environment_context>\n<cwd>/repo</cwd>\n</environment_context>\n<thinking>Need inspect files.</thinking>',
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('system-context');
});

test('marks execution-report style Codex output as low-value', () => {
  const assessment = assessPlanValue({
    content: `Fixed and pushed to \`feat/plannotator-integration\` in commit \`3f67f1c\`.

Changes:
- [daemon.ts] retries failed cloud sent reports without re-sending duplicate Plannotator payloads.
- [plannotator.ts] bounds expiry sweeps to 200 pending write-backs per poll.

Verification:
- \`bunx biome check packages/cli/src/daemon.ts packages/ee/convex/plannotator.ts\` passed.
- \`bun test\` passed.
- Full \`bun run check\` still fails on unrelated diagnostics.

::git-stage{cwd="/repo"}
::git-commit{cwd="/repo"}
::git-push{cwd="/repo" branch="feat/plannotator-integration"}`,
    metadata: { sessionId: 'codex-session' },
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('execution-report');
});

test('keeps structured implementation plans as valuable', () => {
  const assessment = assessPlanValue({
    content: `# Plan: Add login validation

## Context
Login currently accepts empty credentials.

## Approach
Add shared validation before submit and reuse existing error UI.

## Steps
- [ ] Add validation helper
- [ ] Wire helper into login form
- [ ] Add tests

## Verification
Run the login form tests.`,
  });

  expect(assessment.lowValue).toBe(false);
  expect(assessment.reasons).toEqual([]);
});

test('keeps short checklist plans as valuable', () => {
  const assessment = assessPlanValue({ content: '- [ ] Fix login bug' });

  expect(assessment.lowValue).toBe(false);
});

test('Codex proposed-plan blocks are a strong positive signal', () => {
  const assessment = assessPlanValue({
    content: '## Steps\n- [ ] Update parser\n- [ ] Add tests',
    metadata: { planBlocks: 1 },
  });

  expect(assessment.lowValue).toBe(false);
  expect(assessment.signals).toContain('metadata:proposed-plan-block');
});

test('annotation metadata is deterministic and removes stale low-value keys from valuable plans', () => {
  const plan: Plan = {
    id: 'p1',
    agent: 'test-agent',
    title: 'Useful plan',
    content: '## Approach\nAdd validation.\n\n## Steps\n- [ ] Implement helper\n- [ ] Test helper',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: {
      source: 'adapter',
      lowValue: true,
      lowValueReasons: ['prompt-like'],
      lowValueSignals: ['shape:single-line'],
    },
  };

  const annotated = annotatePlanValueMetadata(plan);

  expect(annotated.metadata.source).toBe('adapter');
  expect(annotated.metadata.lowValue).toBeUndefined();
  expect(annotated.metadata.lowValueReasons).toBeUndefined();
  expect(annotated.metadata.lowValueSignals).toBeUndefined();
});
