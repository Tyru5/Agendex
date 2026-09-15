import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useConvex, useMutation } from 'convex/react';
import { buildEncryptedPlanContentEdit, buildEncryptedPlanRename } from '../lib/cloud-plan-edits';
import { withWorkspaceKey } from '../lib/obfuscation-keyring';

export function useCloudPlanEdits() {
  const convex = useConvex();
  const renameMutation = useMutation(api.plans.renamePlan);
  const updateMutation = useMutation(api.plans.updatePlanContent);

  async function encryptedContext(planId: Id<'plans'>) {
    // Resolve current policy at submission, including changes since the editor opened.
    const status = await convex.query(api.workspaceCrypto.getWorkspaceCryptoStatus, {});
    if (!status) throw new Error('Cloud privacy status is unavailable');
    if (!status.settings) return null;
    const plan = await convex.query(api.plans.getPlan, { planId });
    return {
      workspaceOwnerId: status.workspaceOwnerId,
      keyEpoch: status.settings.activeKeyEpoch,
      plan,
    };
  }

  return {
    rename: async (planId: Id<'plans'>, title: string) => {
      const context = await encryptedContext(planId);
      const args = context
        ? withWorkspaceKey(
            context.workspaceOwnerId,
            (workspaceKey) => buildEncryptedPlanRename({ ...context, workspaceKey, title }),
            context.keyEpoch,
          )
        : { title };
      return renameMutation({ planId, ...args });
    },
    updateContent: async (planId: Id<'plans'>, title: string, content: string) => {
      const context = await encryptedContext(planId);
      const args = context
        ? withWorkspaceKey(
            context.workspaceOwnerId,
            (workspaceKey) =>
              buildEncryptedPlanContentEdit({ ...context, workspaceKey, title, content }),
            context.keyEpoch,
          )
        : { title, content };
      return updateMutation({ planId, ...args });
    },
  };
}
