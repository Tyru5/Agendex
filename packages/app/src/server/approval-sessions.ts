import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApprovalDecision, ApprovalSession } from '@agendex/shared/approval-gates';

const LEASE_MS = 60_000;
const RETENTION_MS = 3_600_000;
export const planRevision = (content: string): string =>
  createHash('sha256').update(content).digest('hex');
export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429,
  ) {
    super(message);
  }
}
interface StoredSession {
  session: ApprovalSession;
  ownerHash: string;
  heartbeatAt: number;
}
function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
/** Process-local by design: a server restart cannot replay a previously granted permission. */
export class ApprovalSessions {
  private rows = new Map<string, StoredSession>();
  constructor(private now: () => number = Date.now) {}
  private sweep() {
    const now = this.now();
    for (const [id, row] of this.rows) {
      if (
        row.session.acknowledgedAt === undefined &&
        ['pending', 'approved', 'changes_requested', 'rejected'].includes(row.session.status)
      ) {
        if (now >= row.session.expiresAt) row.session.status = 'expired';
        else if (now - row.heartbeatAt >= LEASE_MS) row.session.status = 'disconnected';
      }
      if (now > row.session.expiresAt + RETENTION_MS) this.rows.delete(id);
    }
  }
  create(input: Record<string, unknown>): ApprovalSession {
    this.sweep();
    if (
      !validText(input.id, 128) ||
      !/^[a-zA-Z0-9_-]+$/.test(input.id) ||
      !validText(input.ownerKey, 128) ||
      !/^[a-f0-9]{64}$/.test(input.ownerKey) ||
      !validText(input.agentSessionId, 256) ||
      !validText(input.title, 256) ||
      !validText(input.content, 1_000_000) ||
      (typeof input.content === 'string' &&
        Buffer.byteLength(input.content, 'utf-8') > 1_000_000) ||
      !['claude-code', 'manual'].includes(String(input.agent)) ||
      typeof input.timeoutMs !== 'number' ||
      !Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < 1000 ||
      input.timeoutMs > 3_600_000
    ) {
      throw new ApprovalError('Invalid approval session input', 400);
    }
    const revision = planRevision(input.content);
    const existing = this.rows.get(input.id);
    if (existing) {
      this.authorize(existing, input.ownerKey);
      if (
        existing.session.revision !== revision ||
        existing.session.agentSessionId !== input.agentSessionId ||
        existing.session.agent !== input.agent
      )
        throw new ApprovalError('Session ID already belongs to another request', 409);
      return { ...existing.session };
    }
    if (this.rows.size >= 200)
      throw new ApprovalError('Review queue is full; retry after active reviews finish', 429);
    const now = this.now();
    const session: ApprovalSession = {
      id: input.id,
      agent: input.agent as ApprovalSession['agent'],
      agentSessionId: input.agentSessionId,
      title: input.title,
      content: input.content,
      revision,
      createdAt: now,
      expiresAt: now + input.timeoutMs,
      status: 'pending',
    };
    this.rows.set(session.id, {
      session,
      ownerHash: planRevision(input.ownerKey),
      heartbeatAt: now,
    });
    return { ...session };
  }
  list(): ApprovalSession[] {
    this.sweep();
    return [...this.rows.values()]
      .map(({ session }) => ({ ...session }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  private get(id: string): StoredSession {
    this.sweep();
    const row = this.rows.get(id);
    if (!row) throw new ApprovalError('Review session not found', 404);
    return row;
  }
  private authorize(row: StoredSession, ownerKey: unknown) {
    if (
      typeof ownerKey !== 'string' ||
      !timingSafeEqual(Buffer.from(row.ownerHash), Buffer.from(planRevision(ownerKey)))
    )
      throw new ApprovalError('Wrong review session owner', 403);
  }
  heartbeat(id: string, ownerKey: unknown, revision: unknown): ApprovalSession {
    const row = this.get(id);
    this.authorize(row, ownerKey);
    if (
      revision !== row.session.revision &&
      row.session.acknowledgedAt === undefined &&
      !['expired', 'disconnected', 'cancelled'].includes(row.session.status)
    )
      row.session.status = 'superseded';
    row.heartbeatAt = this.now();
    return { ...row.session };
  }
  decide(id: string, revision: unknown, decision: unknown, feedback: unknown): ApprovalSession {
    const row = this.get(id);
    if (revision !== row.session.revision)
      throw new ApprovalError('Plan revision changed; reload before deciding', 409);
    if (
      !['approved', 'changes_requested', 'rejected'].includes(String(decision)) ||
      (feedback !== undefined && (typeof feedback !== 'string' || feedback.length > 10_000))
    )
      throw new ApprovalError('Invalid review decision', 400);
    if (decision !== 'approved' && !validText(feedback, 10_000))
      throw new ApprovalError('Feedback is required for changes or rejection', 400);
    if (row.session.status === decision && row.session.feedback === feedback)
      return { ...row.session };
    if (row.session.status !== 'pending')
      throw new ApprovalError('Review is no longer pending', 409);
    Object.assign(row.session, {
      status: decision as ApprovalDecision,
      feedback,
      reviewedAt: this.now(),
      reviewedBy: 'local-token',
    });
    return { ...row.session };
  }
  cancel(id: string, ownerKey?: unknown): ApprovalSession {
    const row = this.get(id);
    if (ownerKey !== undefined) this.authorize(row, ownerKey);
    if (row.session.acknowledgedAt !== undefined)
      throw new ApprovalError('Decision already acknowledged by the agent', 409);
    if (!['expired', 'disconnected', 'superseded'].includes(row.session.status))
      row.session.status = 'cancelled';
    return { ...row.session };
  }
  acknowledge(id: string, ownerKey: unknown, revision: unknown): ApprovalSession {
    const row = this.get(id);
    this.authorize(row, ownerKey);
    if (revision !== row.session.revision) {
      row.session.status = 'superseded';
      throw new ApprovalError('Revision changed before delivery', 409);
    }
    if (!['approved', 'changes_requested', 'rejected'].includes(row.session.status))
      throw new ApprovalError('No live decision to acknowledge', 409);
    row.session.acknowledgedAt ??= this.now();
    return { ...row.session };
  }
}
