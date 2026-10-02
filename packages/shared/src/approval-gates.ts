/** A live approval is bound to one immutable plan snapshot, never a reusable plan ID. */
export type ApprovalDecision = 'approved' | 'changes_requested' | 'rejected';
export type ApprovalStatus =
  | 'pending'
  | ApprovalDecision
  | 'cancelled'
  | 'expired'
  | 'disconnected'
  | 'superseded';
export interface ApprovalSession {
  id: string;
  agent: 'claude-code' | 'manual';
  agentSessionId: string;
  title: string;
  content: string;
  revision: string;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  feedback?: string;
  reviewedAt?: number;
  /** OSS authenticates one local account token, not named cloud users. */
  reviewedBy?: 'local-token';
  acknowledgedAt?: number;
}
