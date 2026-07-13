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
- \`bun run lint -- packages/cli/src/daemon.ts packages/ee/convex/plannotator.ts\` passed.
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

test('keeps detailed migration plans that mention completion vocabulary and backticked identifiers', () => {
  const assessment = assessPlanValue({
    title: 'Migration Plan — studio.client → Convex (strangler-fig) · v3',
    content: `# Migration Plan — studio.client → Convex

## Context
The studio client currently talks to the legacy backend over a \`NatsConnection\`.
Requests that failed previously are retried; nothing has changed in the wire format.

## Steps
1. Introduce a Convex adapter behind the existing interface.
2. Route reads through Convex once backfill is done.
3. Remove the legacy path after the cutover is resolved.

## Verification
Each phase will be verified against staging before the next begins.`,
  });

  expect(assessment.lowValue).toBe(false);
  expect(assessment.reasons).toEqual([]);
});

test('marks Codex wrapper-title final answers as low-value when they are not plans', () => {
  const assessment = assessPlanValue({
    title: '<user_action>',
    content: `The patch introduces a regression and should not be considered correct as-is.

Full review comments:
- [P1] Wire the selected bridge into recording behavior
- [P2] Fix keyboard interaction`,
    metadata: { sessionId: 'codex-session' },
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('wrapper-title');
  expect(assessment.reasons).toContain('review-output');
});

test('marks <recommended_plugins> and other XML envelope titles as wrappers', () => {
  for (const title of [
    '<recommended_plugins>',
    '<subagent_notification>',
    '<environment_context>',
    '<hook_prompt hook_run_id="stop:1">',
  ]) {
    const assessment = assessPlanValue({
      title,
      content: 'Updated the parser and verified the change.\n\nVerification:\n- `bun test` passed.',
      metadata: { sessionId: 'codex-session' },
    });

    expect(assessment.lowValue).toBe(true);
    expect(assessment.reasons).toContain('wrapper-title');
  }
});

test('marks Codex progress narrations joined by --- as low-value', () => {
  const assessment = assessPlanValue({
    title: 'the ci/cd for this PR failed. investigate and resolve the root issues.',
    content: `I'll start from the failing PR checks and job logs, then trace each failure to its source.

---

I'm using the github:gh-fix-ci skill because this is a failing GitHub PR-check investigation.

---

I'm now correlating the failing job logs with that exact patch.

---

I've isolated two root causes and I'm tracing the fixture/boot-helper contract.

---

Implementation is in place. I'm starting with the two pure helper suites.

---

The helper tests pass 19/19 and Playwright successfully discovers the affected projects.`,
    metadata: { sessionId: 'codex-session' },
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('progress-narrative');
});

test('does not treat prose starting with Plan: or Verification is as section structure', () => {
  const assessment = assessPlanValue({
    content: `I've isolated two root causes.

Plan: centralize the selection action and update the readiness gates. I'll cover the handler with focused tests.

---

Verification is running in parallel: full Electron unit suite and typecheck.

---

I'm waiting on the captured result before publishing.`,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.signals).not.toContain('section:implementation-plan');
  expect(assessment.signals).not.toContain('section:verification');
  expect(assessment.reasons).toContain('progress-narrative');
});

test('marks FAIL/PASS Codex status verdicts as low-value review/execution output', () => {
  const assessment = assessPlanValue({
    title: '<recommended_plugins>',
    content: `FAIL

- True first-bad commit remains \`c7f8f6f86\`. Its parent advertises the legacy \`9321\`.
- HIL evidence is conclusive: mDNS advertising \`9421\`, followed by \`ECONNREFUSED :9421\`.
- Focused tests pass: 10/10 across mDNS registration.

Remaining contract gaps:

1. mdns-ipc still falls back to a static port when the caller supplies no service.
2. mDNS resolves the port only once after rebind.

The immediate HIL first-boot regression is fixed, but the broader contract is not yet complete.`,
    metadata: { sessionId: 'codex-session' },
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('wrapper-title');
  expect(
    assessment.reasons.includes('review-output') || assessment.reasons.includes('execution-report'),
  ).toBe(true);
});

test('keeps plans with imperative Fail steps as valuable', () => {
  const assessment = assessPlanValue({
    title: 'Bandwidth Governor HIL Coverage',
    content: `# Bandwidth Governor HIL Coverage

## Context
The HIL test needs deterministic diagnostics around the real room state.

## Implementation
1. Add a renderer probe that uses the existing public LiveKit APIs.
Fail with explicit diagnostics when the proxy, agent ID, resource, or track cannot be resolved.
2. Add lifecycle recovery coverage for the selected camera.

## Verification
Run the focused Electron and HIL tests.`,
    metadata: { sessionId: 'generic-beaming-dusk' },
  });

  expect(assessment.lowValue).toBe(false);
  expect(assessment.reasons).toEqual([]);
  expect(assessment.signals).not.toContain('negative:review-output');
  expect(assessment.signals).not.toContain('negative:execution-report');
});

test('marks accessibility/review finding lists as low-value', () => {
  const assessment = assessPlanValue({
    content: `Three findings:

1. **[P1] Dialogs have no accessible name** — studio-picker.tsx. Add stable title IDs.
2. **[P2] Current studio is visual-only** — studio-card.tsx. Add aria-current.
3. **[P1] Hive users can receive Iris branding** — use-root-bootstrap.ts.

Read-only review; no files modified.`,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('review-output');
});

test('marks JSON red-team finding payloads as low-value', () => {
  const assessment = assessPlanValue({
    content: `{"severity":"INFORMATIONAL","confidence":10,"path":"auto-link-controller.ts","line":730,"category":"maintainability","summary":"The unbounded promise disables recovery.","fix":"Model human waiting explicitly."}`,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('review-output');
});

test('marks curly-apostrophe Codex progress narrations as low-value', () => {
  const assessment = assessPlanValue({
    title: 'the ci/cd for this PR failed. investigate and resolve the root issues.',
    content: `I’ll start from the failing PR checks and job logs, then trace each failure to its source.

---

I’m using the github:gh-fix-ci skill because this is a failing investigation.

---

I’m now correlating the failing job logs with that exact patch.

---

I’ve isolated two root causes and I’m tracing the fixture contract.

---

Implementation is in place. I’m starting with the two pure helper suites.`,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('progress-narrative');
});

test('marks <task> / TASK: / LENS: harness titles as low-value wrappers', () => {
  for (const title of [
    '<task>Write a commit message for the staged changes below.</task>',
    'TASK: Final goal/constraint verification for current HEAD',
    'LENS: DX — process / rule compliance',
  ]) {
    const assessment = assessPlanValue({
      title,
      content: 'Updated the parser and verified the change.\n\nVerification:\n- `bun test` passed.',
      metadata: { sessionId: 'codex-session' },
    });

    expect(assessment.lowValue).toBe(true);
    expect(assessment.reasons).toContain('wrapper-title');
  }
});

test('does not mark structured plans low-value solely for wrapper titles', () => {
  for (const title of [
    '<task>Draft a mobile optimization plan</task>',
    'TASK: Mobile optimization plan',
    'LENS: Mobile optimization plan',
  ]) {
    const assessment = assessPlanValue({
      title,
      content: `# Mobile Optimization Plan

## Approach
Use responsive CSS and a collapsible nav.

## Steps
1. Replace hide-only mobile CSS
2. Add responsive nav

## Verification
Open the landing page on a phone-width viewport.`,
    });

    expect(assessment.lowValue).toBe(false);
    expect(assessment.reasons).not.toContain('wrapper-title');
  }
});

test('marks conventional commit messages as low-value without plan structure', () => {
  const assessment = assessPlanValue({
    title: '<task>Write a commit message for the staged changes below.</task>',
    content: `chore: add grok updater

Add grok to the agent tool list, include its install path on Windows and Unix, probe \`grok --version\`, and update it via \`grok update\` with curl install fallback when the binary is missing.`,
    metadata: { sessionId: 'codex-session' },
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('wrapper-title');
  expect(assessment.reasons).toContain('commit-message');
});

test('marks execution reports with ordered steps but no plan structure as low-value', () => {
  const assessment = assessPlanValue({
    title: 'Please resolve this bug:',
    content: `Fixed the stale-closure bug in use-root-bootstrap.ts.

1. Patched the hook to capture the latest callback
2. Updated the dependent effect
3. Verified the boot sequence

Verification:
- \`bun test\` passed
- \`git push\` completed`,
    metadata: { sessionId: 'codex-session' },
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('execution-report');
});

test('marks review JSON outputs as low-value', () => {
  const assessment = assessPlanValue({
    title: "Review the code changes against the base branch 'main'.",
    content:
      '{"findings":[{"title":"[P1] Fix the bug","body":"Details"}],"overall_correctness":"patch is incorrect"}',
    metadata: { sessionId: 'codex-session' },
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('review-output');
});

test('marks code-only fenced blocks as low-value', () => {
  const assessment = assessPlanValue({
    content: `\`\`\`ts
export function add(a: number, b: number) {
  return a + b;
}
\`\`\``,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('code-only');
});

test('marks code-dominated answers without plan structure as low-value', () => {
  const assessment = assessPlanValue({
    content: `Use this helper:

\`\`\`ts
${Array.from({ length: 40 }, (_, i) => `export const value${i} = ${i};`).join('\n')}
\`\`\``,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('code-dominated');
});

test('marks role-labeled conversation transcripts as low-value', () => {
  const assessment = assessPlanValue({
    content: `**user**: Can you check this?

**assistant**: I looked at it and the files seem fine.

**user**: Thanks.`,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('conversation-artifact');
});

test('marks tool logs as low-value', () => {
  const assessment = assessPlanValue({
    content: `<tool_call>{"name":"grep","args":{"pattern":"TODO"}}</tool_call>
<tool_result>{"matches":[]}</tool_result>`,
  });

  expect(assessment.lowValue).toBe(true);
  expect(assessment.reasons).toContain('tool-log');
});

test('keeps code-heavy implementation plans when planning structure is explicit', () => {
  const assessment = assessPlanValue({
    content: `# Plan: Add helper

## Approach
Create a shared helper and wire it into the form.

## Steps
- [ ] Add helper
- [ ] Update form
- [ ] Add tests

## Reference implementation

\`\`\`ts
${Array.from({ length: 40 }, (_, i) => `export const value${i} = ${i};`).join('\n')}
\`\`\`

## Verification
Run the form tests.`,
  });

  expect(assessment.lowValue).toBe(false);
});

test('keeps prose-only plans with enough actionable planning language', () => {
  const assessment = assessPlanValue({
    content:
      'We will update the login form validation and implement a shared helper that validates credentials before submit. The implementation should reuse the existing error component, add tests for empty credentials, verify the disabled state, and document the expected behavior in the form test suite.',
  });

  expect(assessment.lowValue).toBe(false);
});

test('keeps terse multi-action prose plans as valuable', () => {
  const assessment = assessPlanValue({
    content: 'Update validation, add tests, verify it works.',
  });

  expect(assessment.lowValue).toBe(false);
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
