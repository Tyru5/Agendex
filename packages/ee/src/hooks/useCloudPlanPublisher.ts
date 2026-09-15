import { computeOpaqueToken, encryptPlanWrite } from '@agendex/shared/crypto';
import { assessPlanValue } from '@agendex/shared/plan-value';
import { api } from '@convex/_generated/api';
import { useConvex, useMutation } from 'convex/react';
import { withWorkspaceKey } from '../lib/obfuscation-keyring';
import { useWorkspaceCryptoStatus } from './useCloudMetadataCrypto';
import { toPlanMetadataDto } from '../../convex/planMetadata';

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
  const cryptoStatus = useWorkspaceCryptoStatus();

  return async (plan: CloudPlanPublishInput) => {
    if (!cryptoStatus) throw new Error('Cloud privacy status is unavailable');
    if (!cryptoStatus?.settings) {
      return publishPlan({ ...plan, metadata: toPlanMetadataDto(plan.metadata) });
    }

    const workspaceOwnerId = cryptoStatus.workspaceOwnerId;
    const keyEpoch = cryptoStatus.settings.activeKeyEpoch;
    const localPlanToken = withWorkspaceKey(
      workspaceOwnerId,
      (_workspaceKey, keys) => computeOpaqueToken(keys.indexKey, 'local-plan', [plan.localPlanId]),
      keyEpoch,
    );
    const existing = await convex.query(api.plans.getPlanCryptoIdentity, { localPlanToken });
    const encrypted = withWorkspaceKey(
      workspaceOwnerId,
      (workspaceKey) =>
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
      keyEpoch,
    );
    return publishPlan(encrypted);
  };
}
