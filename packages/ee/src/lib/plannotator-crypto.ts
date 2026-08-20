import { computeOpaqueToken, encryptWorkspaceValue } from '@agendex/shared/crypto';
import type { Plan } from '@agendex/web';
import { withWorkspaceKey } from './obfuscation-keyring.ts';

export function buildEncryptedWriteback(args: {
  workspaceOwnerId: string;
  keyEpoch: number;
  plan: Plan;
  action?: 'request_changes' | 'approve';
  feedback: string;
  revisedContent?: string;
  annotations?: unknown[];
}) {
  if (!args.plan.localPlanId) throw new Error('Plan is not linked to a local daemon record');
  const localPlanId = args.plan.localPlanId;
  return withWorkspaceKey(args.workspaceOwnerId, (workspaceKey, derivedKeys) => {
    const encrypted = encryptWorkspaceValue({
      workspaceKey,
      workspaceOwnerId: args.workspaceOwnerId,
      keyEpoch: args.keyEpoch,
      table: 'plannotatorWritebacks',
      slot: 'writeback',
      value: {
        localPlanId,
        action: args.action ?? 'request_changes',
        feedback: args.feedback,
        revisedContent: args.revisedContent,
        annotations: args.annotations,
        source: 'agendex-cloud',
      },
    });
    return {
      feedback: '',
      clientCryptoProtocol: 1 as const,
      stableCryptoId: encrypted.stableCryptoId,
      keyEpoch: encrypted.keyEpoch,
      encryptedWriteback: encrypted.envelope,
      localPlanToken: computeOpaqueToken(derivedKeys.indexKey, 'local-plan', [localPlanId]),
    };
  });
}
