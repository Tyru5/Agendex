import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeCodeAdapter } from './claude-code.ts';
import { resolveUsageSession } from '../usage/session-cost.ts';
import { getUsageSummary } from '../usage/service.ts';
import { getPlanSessionCost } from '../services/plan-session-cost.ts';

test('Claude plan session provenance distinguishes explicit, guessed, and conflicting IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-claude-session-'));
  try {
    const path = join(dir, '12345678-aaaa-bbbb-cccc-ddddeeeeffff.md');
    await writeFile(path, '# Plan\n\n1. Update source files.');
    let [plan] = await claudeCodeAdapter.parse(path);
    if (!plan) throw new Error('Expected plan');
    expect(plan.metadata.sessionIdOrigin).toBe('filename');
    expect(resolveUsageSession(plan)).toBe('unverified-session');
    await writeFile(path, '---\nsessionId: native-session\n---\n# Plan\n\n1. Update source files.');
    [plan] = await claudeCodeAdapter.parse(path);
    if (!plan) throw new Error('Expected plan');
    expect(resolveUsageSession(plan)).toEqual({
      agent: 'claude-code',
      sessionId: 'native-session',
    });
    await writeFile(
      path,
      '---\nsessionId: "native-session" # explicit ID\nsession_id: native-session\nconversationId: \'native-session\'\n---\n# Plan\n\n1. Update source files.',
    );
    [plan] = await claudeCodeAdapter.parse(path);
    if (!plan) throw new Error('Expected quoted plan');
    expect(plan.metadata.sessionId).toBe('native-session');
    expect(plan.metadata.sessionIdOrigin).toBe('frontmatter');
    expect(resolveUsageSession(plan)).toEqual({
      agent: 'claude-code',
      sessionId: 'native-session',
    });

    await writeFile(
      path,
      '---\nsessionId: native-session\nconversationId: unrelated\n---\n# Plan\n\n1. Update source files.',
    );
    [plan] = await claudeCodeAdapter.parse(path);
    if (!plan) throw new Error('Expected plan');
    expect(resolveUsageSession(plan)).toBe('ambiguous-session');

    await writeFile(
      path,
      '---\nsessionId: native-session\nsessionId: other-session\n---\n# Plan\n\n1. Update source files.',
    );
    [plan] = await claudeCodeAdapter.parse(path);
    if (!plan) throw new Error('Expected plan');
    expect(plan.metadata.sessionIdOrigin).toBe('ambiguous');
    expect(resolveUsageSession(plan)).toBe('ambiguous-session');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('quoted native Claude frontmatter joins provider-reported transcript cost', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-claude-quoted-'));
  try {
    const path = join(dir, 'plan.md');
    await writeFile(
      path,
      '---\nsessionId: "native-claude"\nsession_id: \'native-claude\'\n---\n# Plan\n\n1. Update source files.',
    );
    const [plan] = await claudeCodeAdapter.parse(path);
    if (!plan) throw new Error('Expected native plan');
    await writeFile(
      join(dir, 'native.jsonl'),
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date().toISOString(),
        sessionId: 'native-claude',
        requestId: 'request',
        costUSD: 2.5,
        message: { id: 'message', model: 'unknown', usage: { input_tokens: 10, output_tokens: 5 } },
      }) + '\n',
    );
    await writeFile(
      join(dir, 'usage-model-rates.json'),
      JSON.stringify({ fetchedAt: Date.now(), raw: {} }),
    );
    const cost = await getPlanSessionCost(plan, [plan], (session) =>
      getUsageSummary({
        days: 90,
        session,
        sources: [{ agent: 'claude-code', dir }],
        cacheDir: dir,
      }),
    );
    expect(cost).toMatchObject({
      status: 'available',
      sessionId: 'native-claude',
      costUsd: 2.5,
      totalTokens: 15,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
