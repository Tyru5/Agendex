import { randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '@agendex/shared';
import type { ApprovalSession } from '@agendex/shared/approval-gates';

const revisionOf = (content: string) => createHash('sha256').update(content).digest('hex');
export function claudeReviewOutput(
  status: string,
  feedback?: string,
  approvedInput?: Record<string, unknown>,
) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision:
        status === 'approved'
          ? { behavior: 'allow', ...(approvedInput ? { updatedInput: approvedInput } : {}) }
          : {
              behavior: 'deny',
              message:
                feedback ||
                `Agendex plan review ${status}. Submit a new review before implementation.`,
              ...(status === 'rejected' ? { interrupt: true } : {}),
            },
    },
  };
}
export interface ReviewDependencies {
  input?: () => Promise<string>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  token?: string;
  signal?: AbortSignal;
}
async function readHookInput(): Promise<string> {
  let result = '';
  for await (const chunk of process.stdin) {
    result += chunk.toString();
    if (result.length > 1_100_000) throw new Error('Hook input is too large');
  }
  return result;
}
/** Return explicit deny JSON on every Claude failure; nonzero alone does not deny PermissionRequest. */
export async function runReviewPlan(
  args: string[],
  deps: ReviewDependencies = {},
): Promise<number> {
  // Recognize the intended Claude hook even when strict parsing fails, so malformed
  // invocation options still return an explicit denial rather than silent exit1.
  const rawAgent = args.reduce<string | undefined>(
    (value, item, index) =>
      item === '--agent' ? args[index + 1] : item.startsWith('--agent=') ? item.slice(8) : value,
    undefined,
  );
  let hook = args.some((item) => item === '--hook' || item.startsWith('--hook='));
  let agent = rawAgent;
  let claude = hook && agent === 'claude-code';
  let session: ApprovalSession | undefined;
  let cancelled = false;
  const parentPid = process.ppid;
  const ownerKey = randomBytes(32).toString('hex');
  const http = deps.fetch ?? fetch;
  const controller = new AbortController();
  const onSignal = () => {
    cancelled = true;
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  deps.signal?.addEventListener('abort', onSignal, { once: true });
  let request:
    | ((path: string, body: unknown, signal?: AbortSignal) => Promise<ApprovalSession>)
    | undefined;
  try {
    const { values } = parseArgs({
      args: args[0] === 'review-plan' ? args.slice(1) : args,
      strict: true,
      allowPositionals: false,
      options: {
        hook: { type: 'boolean' },
        agent: { type: 'string' },
        file: { type: 'string' },
        server: { type: 'string' },
        timeout: { type: 'string' },
        dev: { type: 'boolean' },
      },
    });
    hook = values.hook ?? false;
    agent = values.agent;
    claude = hook && agent === 'claude-code';
    if (hook && !claude)
      throw new Error(
        `${agent || 'Unknown agent'} has no supported plan-permission hook. Codex Stop is a continuation hook, not a permission gate.`,
      );
    const timeoutRaw = values.timeout ?? '1800';
    if (!/^\d+$/.test(timeoutRaw) || Number(timeoutRaw) < 1 || Number(timeoutRaw) > 3600)
      throw new Error('--timeout must be 1–3600 seconds');
    const timeoutMs = Number(timeoutRaw) * 1000;
    const url = new URL(values.server ?? process.env.AGENDEX_REVIEW_URL ?? 'http://127.0.0.1:4890');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    )
      throw new Error('--server must be an HTTP(S) origin without credentials');
    const token = deps.token ?? process.env.AGENDEX_TOKEN ?? loadConfig()?.token;
    if (!token)
      throw new Error(
        'Start Agendex first and use its existing local API token. No token was created.',
      );
    let content: string;
    let approvedInput: Record<string, unknown> | undefined;
    let agentSessionId = `manual:${randomUUID()}`;
    let file = values.file;
    if (claude) {
      const input = JSON.parse(await (deps.input ?? readHookInput)()) as Record<string, unknown>;
      if (
        input.hook_event_name !== 'PermissionRequest' ||
        input.tool_name !== 'ExitPlanMode' ||
        typeof input.session_id !== 'string' ||
        !input.session_id.trim()
      )
        throw new Error('Expected a Claude ExitPlanMode PermissionRequest with session_id');
      const tool = input.tool_input as Record<string, unknown> | undefined;
      if (!tool || typeof tool.plan !== 'string' || !tool.plan.trim())
        throw new Error(
          'Claude did not supply tool_input.plan. Upgrade Claude Code; Agendex will not guess another session’s plan file.',
        );
      content = tool.plan;
      approvedInput = { ...tool, plan: content };
      agentSessionId = input.session_id;
      if (typeof tool.planFilePath !== 'string' || !isAbsolute(tool.planFilePath))
        throw new Error(
          'Claude did not supply an absolute tool_input.planFilePath. Upgrade Claude Code; the plan source cannot be verified.',
        );
      file = tool.planFilePath;
      if (revisionOf(await readFile(file, 'utf-8')) !== revisionOf(content))
        throw new Error(
          'Claude plan snapshot no longer matches its source file; submit a fresh review.',
        );
    } else {
      if (!file)
        throw new Error(
          'Usage: agendex review-plan --file <plan.md> [--server <origin>] [--timeout <seconds>]',
        );
      content = await readFile(file, 'utf-8');
    }
    if (!content.trim() || Buffer.byteLength(content, 'utf-8') > 1_000_000)
      throw new Error('Plan must be nonempty and at most 1 MB');
    const revision = revisionOf(content);
    request = async (path, body, signal = controller.signal) => {
      const response = await http(new URL(`/api/v1/review-sessions${path}`, url), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error(`Agendex review API returned ${response.status}`);
      return response.json() as Promise<ApprovalSession>;
    };
    session = await request('', {
      id: randomUUID(),
      ownerKey,
      agent: claude ? 'claude-code' : 'manual',
      agentSessionId,
      title: content.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 256) ?? 'Plan approval',
      content,
      timeoutMs,
    });
    console.error(
      `[agendex] Waiting for review at ${url.origin}. Open the Reviews queue. Session ${session.id}; revision ${revision.slice(0, 12)}.`,
    );
    const deadline = Date.now() + timeoutMs;
    while (session.status === 'pending') {
      if (cancelled || deps.signal?.aborted) throw new Error('Review cancelled');
      if (hook && process.ppid !== parentPid) throw new Error('Agent hook parent process exited');
      const currentRevision = file ? revisionOf(await readFile(file, 'utf-8')) : revision;
      session = await request(`/${session.id}/heartbeat`, { ownerKey, revision: currentRevision });
      if (Date.now() >= deadline && session.status === 'pending')
        throw new Error('Review timed out');
      if (session.status === 'pending')
        await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(1000);
    }
    if (['approved', 'changes_requested', 'rejected'].includes(session.status)) {
      const currentRevision = file ? revisionOf(await readFile(file, 'utf-8')) : revision;
      session = await request(`/${session.id}/ack`, { ownerKey, revision: currentRevision });
    }
    if (cancelled || deps.signal?.aborted) throw new Error('Review cancelled');
    if (claude) {
      console.log(
        JSON.stringify(claudeReviewOutput(session.status, session.feedback, approvedInput)),
      );
      return 0;
    }
    console.log(
      JSON.stringify({
        status: session.status,
        revision: session.revision,
        feedback: session.feedback,
      }),
    );
    return session.status === 'approved' ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (session && request) {
      try {
        await request(`/${session.id}/cancel`, { ownerKey }, AbortSignal.timeout(1000));
      } catch {
        /* Heartbeat lease handles unreachable server / killed hook. */
      }
    }
    console.error(`[agendex] ${message}`);
    if (claude) {
      console.log(JSON.stringify(claudeReviewOutput('cancelled', message)));
      return 0;
    }
    return 1;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    deps.signal?.removeEventListener('abort', onSignal);
  }
}
