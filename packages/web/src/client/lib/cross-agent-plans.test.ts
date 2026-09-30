import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Plan } from './api.ts';
import {
  buildHandoffCommand,
  copyHandoffCommand,
  createHandoffContext,
  crossAgentCandidateSignature,
  crossAgentCandidates,
  hydrateCrossAgentCandidates,
  loadCrossAgentLinkReferences,
  suggestCrossAgentPlans,
  quotePosix,
} from './cross-agent-plans.ts';
const text =
  'Implement credential rotation with encrypted storage and transactional revocation. Preserve refresh tokens during concurrent authentication requests and validate expiry handling.';
function plan(id: string, extra: Partial<Plan> = {}): Plan {
  return {
    id,
    agent: 'claude',
    title: id,
    content: text,
    filePath: '/plans/a.md',
    format: 'md',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    workspace: '/repo',
    metadata: {},
    ...extra,
  };
}
describe('cross-agent suggestions', () => {
  test('matches substantial content from a different agent with explainable evidence', () => {
    const current = plan('current');
    const match = plan('match', { agent: 'codex' });
    expect(suggestCrossAgentPlans(current, [match])[0]?.evidence.join()).toContain(
      'Content overlap',
    );
  });
  test('workspace, date, title and generic task language alone are insufficient', () => {
    const current = plan('a', {
      content: 'Add a test and update the plan. Verify acceptance criteria.',
      title: 'same',
    });
    expect(
      suggestCrossAgentPlans(current, [
        plan('b', {
          agent: 'codex',
          title: 'same',
          content: 'Implement new steps and run tests. Verify changes.',
        }),
      ]),
    ).toEqual([]);
  });
  test('shared files require content support and work references are typed', () => {
    const current = plan('a', {
      content: 'Rotate credentials in `src/auth.ts` and `src/token.ts` safely.',
      metadata: { issueUrl: 'https://github.com/example/repo/issues/1' },
    });
    const different = plan('b', {
      agent: 'codex',
      content: 'Unrelated implementation details',
      metadata: { issueUrl: 'https://github.com/example/repo/issues/1' },
    });
    expect(suggestCrossAgentPlans(current, [different])[0]?.evidence[0]).toContain(
      'Shared work reference',
    );
    expect(
      suggestCrossAgentPlans({ ...current, metadata: { issueUrl: { id: 1 } } }, [
        { ...different, metadata: { issueUrl: { id: 1 } } },
      ]),
    ).toEqual([]);
  });
  test('excludes same agent, duplicates, other workspaces, owners, missing workspace and content', () => {
    const current = plan('a', { ownerId: 'owner' });
    const good = plan('b', { agent: 'codex', ownerId: 'owner' });
    const candidates = [
      good,
      good,
      plan('a', { agent: 'codex', ownerId: 'owner' }),
      plan('c', { ownerId: 'owner' }),
      plan('d', { agent: 'codex', workspace: '/other', ownerId: 'owner' }),
      plan('e', { agent: 'codex', ownerId: 'another' }),
    ];
    expect(crossAgentCandidates(current, candidates).map((p) => p.id)).toEqual(['b']);
    expect(suggestCrossAgentPlans({ ...current, workspace: undefined }, candidates)).toEqual([]);
    expect(suggestCrossAgentPlans(current, [{ ...good, content: '' }])).toEqual([]);
  });
  test('bounds cloud candidate hydration to twenty recent distinct plans', () => {
    const candidates = Array.from({ length: 100 }, (_, i) =>
      plan(String(i), { agent: 'codex', updatedAt: String(i).padStart(3, '0') }),
    );
    expect(crossAgentCandidates(plan('current'), candidates)).toHaveLength(20);
    expect(crossAgentCandidates(plan('current'), candidates)[0]?.id).toBe('99');
  });
  test('linked pull requests stored outside metadata count as shared work', async () => {
    const pr = 'pullRequestUrl:https://github.com/example/repo/pull/7';
    const current = plan('a', { content: 'Rotate credentials safely.' });
    const linked = plan('b', { agent: 'codex', content: 'Unrelated implementation details' });
    const viaMetadata = plan('c', {
      agent: 'codex',
      content: 'Other unrelated work',
      metadata: { pullRequestUrl: 'https://github.com/example/repo/pull/7' },
    });
    expect(suggestCrossAgentPlans(current, [linked, viaMetadata])).toEqual([]);
    const links = await loadCrossAgentLinkReferences([current, linked, viaMetadata], async (p) => {
      if (p.id === 'c') throw new Error('no access');
      return [pr];
    });
    expect(links?.get('c')).toEqual([]);
    const suggestions = suggestCrossAgentPlans(current, [linked, viaMetadata], links ?? undefined);
    expect(suggestions.map((s) => s.plan.id)).toEqual(['b', 'c']);
    expect(suggestions[0]?.evidence[0]).toBe(`Shared work reference: ${pr}`);
  });
  test('stale link loading is discarded', async () => {
    let current = true;
    const result = await loadCrossAgentLinkReferences(
      [plan('a'), plan('b')],
      async () => {
        current = false;
        return [];
      },
      () => current,
    );
    expect(result).toBeNull();
  });
  test('candidate signature changes when a candidate is edited or removed', () => {
    const current = plan('a');
    const other = plan('b', { agent: 'codex' });
    const base = crossAgentCandidateSignature(current, [current, other]);
    expect(crossAgentCandidateSignature(current, [current, { ...other }])).toBe(base);
    expect(
      crossAgentCandidateSignature(current, [current, { ...other, updatedAt: '2026-02-01' }]),
    ).not.toBe(base);
    expect(crossAgentCandidateSignature(current, [current])).not.toBe(base);
  });
});
describe('reviewable handoff', () => {
  test('round trips shell metacharacters without executing them', () => {
    const root = mkdtempSync(join(tmpdir(), 'agendex-handoff-'));
    const workspace = join(root, "repo ' $(touch BAD) ; `echo bad`");
    mkdirSync(workspace);
    const contextPath = "/tmp/context ' $(touch BAD) ; `echo bad`.md";
    try {
      const command = buildHandoffCommand(
        plan('a', { workspace, title: '$(touch BAD)' }),
        'codex',
        contextPath,
      );
      const result = spawnSync('sh', ['-c', `codex() { printf '%s' "$1"; }; ${command}`], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(JSON.stringify(contextPath));
      expect(result.stdout).not.toContain('$(touch BAD)'.repeat(2));
      expect(command).not.toContain('--resume');
      expect(command).not.toContain('--dangerously');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('supports Claude positional prompt and rejects invalid targets and paths', () => {
    expect(buildHandoffCommand(plan('a'), 'claude', '/tmp/context.md')).toContain('&& claude ');
    expect(() => buildHandoffCommand(plan('a'), 'amp' as 'codex', '/tmp/a.md')).toThrow(
      'Unsupported',
    );
    expect(() =>
      buildHandoffCommand(plan('a', { workspace: 'relative' }), 'codex', '/tmp/a'),
    ).toThrow('workspace');
    expect(() => buildHandoffCommand(plan('a'), 'codex', 'relative')).toThrow('absolute path');
    for (const value of ['/tmp/a\nb', '/tmp/\x00b', '/tmp/a\rb'])
      expect(() => buildHandoffCommand(plan('a'), 'codex', value)).toThrow('control');
    expect(() => quotePosix('a\x1bb')).toThrow('control');
  });
  test('exports source content even for unsupported source agents and does not invent session state', () => {
    const source = plan('a', {
      agent: 'unsupported',
      content: 'Actual plan',
      metadata: { sessionId: { malformed: true } },
    });
    const exported = createHandoffContext(source);
    expect(exported).toContain('Actual plan');
    expect(exported).toContain('unsupported');
    expect(exported).not.toContain('malformed');
    expect(() => createHandoffContext({ ...source, content: '' })).toThrow('unavailable');
  });
});

test('cloud hydration only loads eligible plans, bounds concurrency, reports unavailable content', async () => {
  let active = 0;
  let maxActive = 0;
  const calls: string[] = [];
  const current = plan('a', { ownerId: 'owner' });
  const candidates = Array.from({ length: 30 }, (_, i) =>
    plan(String(i), { agent: 'codex', content: '', ownerId: 'owner' }),
  );
  candidates.push(plan('private', { agent: 'codex', content: '', ownerId: 'other' }));
  const result = await hydrateCrossAgentCandidates(current, candidates, async (candidate) => {
    calls.push(candidate.id);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (candidate.id === '0') throw new Error('Unavailable');
    if (candidate.id === '1') return null;
    return text;
  });
  expect(calls).toHaveLength(20);
  expect(calls).not.toContain('private');
  expect(maxActive).toBe(4);
  expect(result?.unavailable).toBe(2);
  expect(result?.plans).toHaveLength(18);
});
test('stale cloud hydration discards results and starts no further requests', async () => {
  let current = true;
  let calls = 0;
  const candidates = Array.from({ length: 20 }, (_, i) =>
    plan(String(i), { agent: 'codex', content: '' }),
  );
  const result = await hydrateCrossAgentCandidates(
    plan('a'),
    candidates,
    async () => {
      calls++;
      current = false;
      return text;
    },
    () => current,
  );
  expect(result).toBeNull();
  expect(calls).toBe(4);
});

test('stored aliases and missing agent identities are never cross-agent candidates or hydrated', async () => {
  for (const [sourceAgent, alias] of [
    ['codex-cli', 'codex'],
    ['commandcode', 'command-code'],
    [' CODEX-CLI ', 'codex'],
  ]) {
    const current = plan('source', { agent: sourceAgent });
    const peer = plan('peer', { agent: alias });
    expect(suggestCrossAgentPlans(current, [peer])).toEqual([]);
    let calls = 0;
    const result = await hydrateCrossAgentCandidates(
      current,
      [{ ...peer, content: '' }, plan('missing', { agent: '  ', content: '' })],
      async () => {
        calls++;
        return text;
      },
    );
    expect(calls).toBe(0);
    expect(result?.plans).toEqual([]);
  }
  expect(
    crossAgentCandidates(plan('source', { agent: '' }), [plan('peer', { agent: 'codex' })]),
  ).toEqual([]);
});

test('clipboard failure on tailnet HTTP preserves manual-copy fallback without throwing', async () => {
  expect(await copyHandoffCommand('command')).toBe(false);
  expect(
    await copyHandoffCommand('command', {
      writeText: () => {
        throw new Error('sync denial');
      },
    }),
  ).toBe(false);
  expect(
    await copyHandoffCommand('command', {
      writeText: async () => {
        throw new Error('permission denial');
      },
    }),
  ).toBe(false);
  let actual = '';
  expect(
    await copyHandoffCommand('reviewed command', {
      writeText: async (value) => {
        actual = value;
      },
    }),
  ).toBe(true);
  expect(actual).toBe('reviewed command');
});
