import { expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalSessions } from './approval-sessions.ts';
import { createApprovalRoutes } from './routes/approvals.ts';
import { runReviewPlan } from '../../../cli/src/review-plan.ts';
const hookInput = {
  hook_event_name: 'PermissionRequest',
  tool_name: 'ExitPlanMode',
  session_id: 'test-agent-session',
  tool_input: { plan: '# Review auth\nImplement auth and test it' },
};
async function run(
  decision: string,
  feedback?: string,
  args = ['review-plan', '--hook', '--agent', 'claude-code'],
) {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-hook-'));
  const file = join(dir, 'plan.md');
  await writeFile(file, hookInput.tool_input.plan);
  const actualInput = { ...hookInput, tool_input: { ...hookInput.tool_input, planFilePath: file } };
  const store = new ApprovalSessions();
  const app = new Hono();
  app.route('/api/v1', createApprovalRoutes(store));
  const output = spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const result = await runReviewPlan(args, {
      token: 'fixture',
      input: async () => JSON.stringify(actualInput),
      fetch: async (url, init) => {
        if (args.some((arg) => arg.startsWith('--server=')))
          expect(new URL(String(url)).origin).toBe('http://127.0.0.1:5689');
        const response = await app.request(String(url), init);
        if (new URL(String(url)).pathname.endsWith('/review-sessions')) {
          const row = store.list()[0];
          if (!row) throw new Error('Missing queue item');
          expect(row.agentSessionId).toBe(hookInput.session_id);
          expect(row.content).toBe(hookInput.tool_input.plan);
          if (args.includes('--timeout=2')) expect(row.expiresAt - row.createdAt).toBe(2000);
          if (decision === 'cancelled') store.cancel(row.id);
          else store.decide(row.id, row.revision, decision, feedback);
        }
        return response;
      },
      sleep: async () => undefined,
    });
    expect(result).toBe(0);
    const parsed = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(parsed.hookSpecificOutput.decision.behavior).toBe(
      decision === 'approved' ? 'allow' : 'deny',
    );
    if (decision === 'approved')
      expect(parsed.hookSpecificOutput.decision.updatedInput.plan).toBe(hookInput.tool_input.plan);
    expect(parsed.hookSpecificOutput.decision.interrupt).toBe(
      decision === 'rejected' ? true : undefined,
    );
    if (decision !== 'cancelled') expect(store.list()[0]?.acknowledgedAt).toBeDefined();
  } finally {
    output.mockRestore();
    errors.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
}
test('real CLI-to-Hono review transport approves exact plan snapshot', () => run('approved'));
test('request changes denies with reviewer feedback', () => run('changes_requested', 'Add tests'));
test('reject denies and interrupts Claude', () => run('rejected', 'Wrong implementation'));
test('cancel denies without delivering a grant', () => run('cancelled'));
test('missing plan, invalid event, unavailable server all emit explicit denial JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-offline-hook-'));
  const file = join(dir, 'plan.md');
  await writeFile(file, hookInput.tool_input.plan);
  const valid = { ...hookInput, tool_input: { ...hookInput.tool_input, planFilePath: file } };
  const output = spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = spyOn(console, 'error').mockImplementation(() => undefined);
  let calls = 0;
  try {
    for (const input of [
      { ...valid, tool_input: {} },
      { ...valid, hook_event_name: 'Stop' },
      valid,
    ]) {
      output.mockClear();
      expect(
        await runReviewPlan(['--hook', '--agent', 'claude-code'], {
          token: 'fixture',
          input: async () => JSON.stringify(input),
          fetch: async () => {
            calls++;
            throw new Error('offline');
          },
        }),
      ).toBe(0);
      expect(
        JSON.parse(String(output.mock.calls[0]?.[0])).hookSpecificOutput.decision.behavior,
      ).toBe('deny');
    }
    expect(calls).toBe(1);
  } finally {
    output.mockRestore();
    errors.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('manual disk edits before final ack invalidate approval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-review-'));
  const file = join(dir, 'plan.md');
  await writeFile(file, '# Initial plan');
  const store = new ApprovalSessions();
  const app = createApprovalRoutes(store);
  const output = spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(
      await runReviewPlan(['--file', file], {
        token: 'fixture',
        fetch: async (url, init) => {
          const path = new URL(String(url)).pathname.replace('/api/v1', '');
          const response = await app.request(path, init);
          if (path === '/review-sessions') {
            const row = store.list()[0];
            if (!row) throw new Error('Missing review');
            store.decide(row.id, row.revision, 'approved', undefined);
            await writeFile(file, '# Changed plan');
          }
          return response;
        },
        sleep: async () => undefined,
      }),
    ).toBe(1);
    expect(store.list()[0]?.status).toBe('superseded');
    expect(store.list()[0]?.acknowledgedAt).toBeUndefined();
  } finally {
    output.mockRestore();
    errors.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

const equalsArgs = [
  'review-plan',
  '--hook',
  '--agent=claude-code',
  '--server=http://127.0.0.1:5689',
  '--timeout=2',
];
test('equals-form Claude options approve on selected server and timeout', () =>
  run('approved', undefined, equalsArgs));
test('equals-form Claude options request changes with explicit deny', () =>
  run('changes_requested', 'Add tests', equalsArgs));
test('equals-form Claude options reject with explicit deny', () =>
  run('rejected', 'Wrong plan', equalsArgs));
test('malformed equals-form Claude invocation still explicitly denies', async () => {
  const output = spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    for (const args of [
      ['--hook', '--agent=claude-code', '--timeout=oops'],
      ['--hook', '--agent=claude-code', '--server=ftp://wrong'],
      ['--hook', '--agent=claude-code', '--unknown'],
      ['--hook=true', '--agent=claude-code'],
    ]) {
      output.mockClear();
      expect(await runReviewPlan(args, { token: 'fixture' })).toBe(0);
      expect(
        JSON.parse(String(output.mock.calls[0]?.[0])).hookSpecificOutput.decision.behavior,
      ).toBe('deny');
    }
  } finally {
    output.mockRestore();
    errors.mockRestore();
  }
});
test('equals-form manual file path waits and approves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agendex-equals-file-'));
  const file = join(dir, 'plan with spaces.md');
  await writeFile(file, '# Manual equals plan');
  const store = new ApprovalSessions();
  const app = createApprovalRoutes(store);
  const output = spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(
      await runReviewPlan([`--file=${file}`, '--timeout=2', '--server=http://127.0.0.1:5689'], {
        token: 'fixture',
        fetch: async (url, init) => {
          expect(new URL(String(url)).origin).toBe('http://127.0.0.1:5689');
          const path = new URL(String(url)).pathname.replace('/api/v1', '');
          const response = await app.request(path, init);
          if (path === '/review-sessions') {
            const row = store.list()[0];
            if (!row) throw new Error('No review');
            expect(row.expiresAt - row.createdAt).toBe(2000);
            store.decide(row.id, row.revision, 'approved', undefined);
          }
          return response;
        },
        sleep: async () => undefined,
      }),
    ).toBe(0);
    expect(JSON.parse(String(output.mock.calls[0]?.[0])).status).toBe('approved');
  } finally {
    output.mockRestore();
    errors.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('global dev flag before review-plan reaches review transport', () =>
  run('approved', undefined, ['--dev', 'review-plan', '--hook', '--agent', 'claude-code']));

test('review routes return 400 for bad bodies and 500 for server faults', async () => {
  const post = (app: Hono, body: string) =>
    app.request('/review-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  const app = createApprovalRoutes(new ApprovalSessions());
  expect((await post(app, '{not json')).status).toBe(400);
  expect((await post(app, 'null')).status).toBe(400);
  expect((await post(app, '[]')).status).toBe(400);
  const broken = new ApprovalSessions();
  broken.create = () => {
    throw new TypeError('boom');
  };
  const errors = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const response = await post(createApprovalRoutes(broken), '{}');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal error' });
  } finally {
    errors.mockRestore();
  }
});
