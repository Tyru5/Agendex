import { computeOpaqueToken, encryptPlanWrite } from '@agendex/shared/crypto';
import { assessPlanValue } from '@agendex/shared/plan-value';
import { api } from '@convex/_generated/api';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { withWorkspaceKey } from '../lib/obfuscation-keyring';

export interface CloudPlanPublishInput {
  localPlanId: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath?: string;
  workspace?: string;
  metadata?: Record<string, unknown>;
}

export function useCloudPlanPublisher() {
  const convex = useConvex();
  const publishPlan = useMutation(api.plans.publishPlan);
  const cryptoStatus = useQuery(api.workspaceCrypto.getWorkspaceCryptoStatus, {});

  return async (plan: CloudPlanPublishInput) => {
    if (cryptoStatus === undefined) throw new Error('Cloud privacy status is still loading');
    if (!cryptoStatus?.settings) return publishPlan(plan);

    const workspaceOwnerId = cryptoStatus.workspaceOwnerId;
    const keyEpoch = cryptoStatus.settings.activeKeyEpoch;
    const localPlanToken = withWorkspaceKey(workspaceOwnerId, (_workspaceKey, keys) =>
      computeOpaqueToken(keys.indexKey, 'local-plan', [plan.localPlanId]),
    );
    const existing = await convex.query(api.plans.getPlanCryptoIdentity, { localPlanToken });
    const encrypted = withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
      encryptPlanWrite({
        workspaceKey,
        workspaceOwnerId,
        keyEpoch,
        stableCryptoId: existing?.stableCryptoId,
        plan: {
          ...plan,
          lowValue: assessPlanValue({
            title: plan.title,
            content: plan.content,
            metadata: plan.metadata,
          }).lowValue,
        },
      }),
    );
    return publishPlan(encrypted);
  };
}
