import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexCliAdapter } from './codex-cli.ts';

async function writeRollout(lines: unknown[]): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-codex-'));
  const path = join(dir, 'rollout-2026-07-08T14-37-08-test-session.jsonl');
  await writeFile(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf-8');
  return { dir, path };
}

function sessionMeta(sessionId: string, cwd = '/Users/tiru5/Documents/dotfiles') {
  return {
    type: 'session_meta',
    payload: {
      id: sessionId,
      session_id: sessionId,
      timestamp: '2026-07-08T20:37:11.533Z',
      cwd,
    },
  };
}

function message(role: string, text: string, phase?: string) {
  return {
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      phase,
      content: [{ type: 'output_text', text }],
    },
  };
}

test('matches rollout jsonl session files only', () => {
  expect(codexCliAdapter.matches('/tmp/rollout-2026-01-01-abc.jsonl')).toBe(true);
  expect(codexCliAdapter.matches('/tmp/session.jsonl')).toBe(false);
  expect(codexCliAdapter.matches('/tmp/rollout-2026-01-01-abc.json')).toBe(false);
});

test('ignores low-value final-answer transcripts without proposed_plan blocks', async () => {
  const { dir, path } = await writeRollout([
    sessionMeta('sess-commit'),
    message('user', '<task>Write a commit message for the staged changes below.</task>'),
    message(
      'assistant',
      'chore: add grok updater\n\nAdd grok to the agent tool list and update it via `grok update`.',
      'final_answer',
    ),
  ]);

  try {
    const plans = await codexCliAdapter.parse(path);
    expect(plans).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const PLAN_BODY = `# Mobile Optimization Plan

## Context
Landing page is unusable on phones.

## Steps
- [ ] Replace hide-only mobile CSS
- [ ] Add responsive nav

## Verification
Open the landing page on a phone-width viewport.`;

test('indexes sessions that contain proposed_plan blocks', async () => {
  const { dir, path } = await writeRollout([
    sessionMeta('sess-plan'),
    message('user', 'Please draft a plan for mobile optimization.'),
    message(
      'assistant',
      `Here is the plan:\n\n<proposed_plan>\n${PLAN_BODY}\n</proposed_plan>`,
      'final_answer',
    ),
  ]);

  try {
    const plans = await codexCliAdapter.parse(path);
    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan.agent).toBe('codex-cli');
    expect(plan.title).toBe('Mobile Optimization Plan');
    expect(plan.content).toContain('## Steps');
    expect(plan.content).not.toContain('<proposed_plan>');
    expect(plan.metadata.planBlocks).toBe(1);
    expect(plan.metadata.sessionId).toBe('sess-plan');
    expect(plan.workspace).toBe('/Users/tiru5/Documents/dotfiles');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('indexes plain final-answer markdown plans without proposed_plan wrappers', async () => {
  const { dir, path } = await writeRollout([
    sessionMeta('sess-plain-plan'),
    message('user', 'Please draft a plan for mobile optimization.'),
    message('assistant', PLAN_BODY, 'final_answer'),
  ]);

  try {
    const plans = await codexCliAdapter.parse(path);
    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan.agent).toBe('codex-cli');
    expect(plan.content).toContain('## Steps');
    expect(plan.content).toContain('Mobile Optimization Plan');
    expect(plan.metadata.planBlocks).toBeUndefined();
    expect(plan.metadata.sessionId).toBe('sess-plain-plan');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips plain final answers that only have planning prose without structure', async () => {
  const { dir, path } = await writeRollout([
    sessionMeta('sess-prose-only'),
    message('user', 'Please run this migration on the ITG database.'),
    message(
      'assistant',
      `After you approve, I will:

1. Load the required Iris rules and knowledge.
2. Locate the approved ITG database connection method.
3. Perform read-only preflight checks.
4. Run the migration exactly once.
5. Verify both columns and report the captured results.

Reply "Approved" to continue.`,
      'final_answer',
    ),
  ]);

  try {
    expect(await codexCliAdapter.parse(path)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('returns empty for empty or unreadable rollouts', async () => {
  const { dir, path } = await writeRollout([]);
  try {
    expect(await codexCliAdapter.parse(path)).toEqual([]);
    expect(await codexCliAdapter.parse(join(dir, 'missing-rollout.jsonl'))).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips recommended_plugins envelopes and progress-style final answers', async () => {
  const { dir, path } = await writeRollout([
    sessionMeta('sess-progress'),
    message(
      'user',
      `<recommended_plugins>
Here is a list of plugins that are available but not installed.
</recommended_plugins>
<environment_context>
  <cwd>/Users/tiru5/iris/platform</cwd>
</environment_context>`,
    ),
    message(
      'assistant',
      "I'm using the repository's Iris load protocol first, then I'll trace the commit history.",
      'commentary',
    ),
    message(
      'assistant',
      `FAIL

- True first-bad commit remains \`c7f8f6f86\`.
- HIL evidence is conclusive: mDNS advertising \`9421\`.
- Focused tests pass: 10/10.

Remaining contract gaps:
1. static port fallback still exists
2. mDNS does not re-register after rebind

The immediate regression is fixed, but the broader contract is not yet complete.`,
      'final_answer',
    ),
  ]);

  try {
    const plans = await codexCliAdapter.parse(path);
    expect(plans).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips multi-segment Codex progress narrations without proposed_plan', async () => {
  const { dir, path } = await writeRollout([
    sessionMeta('sess-ci-narration'),
    message('user', 'the ci/cd for this PR failed. investigate and resolve the root issues.'),
    message(
      'assistant',
      `I'll start from the failing PR checks and job logs, then trace each failure.

---

I'm using the github:gh-fix-ci skill because this is a failing investigation.

---

I'm now correlating the failing job logs with that exact patch.

---

I've isolated two root causes and I'm tracing the fixture contract.

---

Implementation is in place. I'm starting with the two pure helper suites.`,
      'final_answer',
    ),
  ]);

  try {
    const plans = await codexCliAdapter.parse(path);
    expect(plans).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unwraps task envelopes for titles when content is a real plan', async () => {
  const { dir, path } = await writeRollout([
    sessionMeta('sess-task-plan'),
    message('user', '<task>Draft a mobile optimization plan for the landing page.</task>'),
    message('assistant', PLAN_BODY, 'final_answer'),
  ]);

  try {
    const plans = await codexCliAdapter.parse(path);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.title).toBe('Draft a mobile optimization plan for the landing page.');
    expect(plans[0]!.content).toContain('## Steps');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
