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

test('ignores sessions without proposed_plan blocks (final-answer transcripts)', async () => {
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

test('indexes sessions that contain proposed_plan blocks', async () => {
  const planBody = `# Mobile Optimization Plan

## Context
Landing page is unusable on phones.

## Steps
- [ ] Replace hide-only mobile CSS
- [ ] Add responsive nav

## Verification
Open the landing page on a phone-width viewport.`;

  const { dir, path } = await writeRollout([
    sessionMeta('sess-plan'),
    message('user', 'Please draft a plan for mobile optimization.'),
    message(
      'assistant',
      `Here is the plan:\n\n<proposed_plan>\n${planBody}\n</proposed_plan>`,
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

test('returns empty for empty or unreadable rollouts', async () => {
  const { dir, path } = await writeRollout([]);
  try {
    expect(await codexCliAdapter.parse(path)).toEqual([]);
    expect(await codexCliAdapter.parse(join(dir, 'missing-rollout.jsonl'))).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
