import type { Plan } from '@agendex/web';
import { decryptPlanBody } from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useMemo, useSyncExternalStore } from 'react';
import {
  getWorkspaceKeyringSnapshot,
  subscribeWorkspaceKeyring,
  withWorkspaceKey,
} from '../lib/obfuscation-keyring';

/**
 * Content for a single cloud plan, fetched lazily when a plan is opened —
 * `getMyPublishedPlans` ships list items without `content`.
 *
 * Returns `undefined` while inactive (null planId) or loading, and `''` when
 * the plan is inaccessible (deleted, hidden, or a stale id): the backing query
 * returns null instead of throwing, so a bad id can never crash the app to an
 * error boundary.
 */
export function useCloudPlanContent(planId: string | null): string | undefined {
  const result = useQuery(api.plans.getMyPlanContent, planId ? { planId } : 'skip');
  const cryptoStatus = useQuery(api.workspaceCrypto.getWorkspaceCryptoStatus, {});
  const workspaceOwnerId = cryptoStatus?.workspaceOwnerId ?? '';
  useSyncExternalStore(
    subscribeWorkspaceKeyring,
    () =>
      getWorkspaceKeyringSnapshot(workspaceOwnerId, cryptoStatus?.settings?.activeKeyEpoch ?? null),
    () =>
      getWorkspaceKeyringSnapshot(workspaceOwnerId, cryptoStatus?.settings?.activeKeyEpoch ?? null),
  );

  if (!planId || result === undefined) return undefined;
  if (result?.encryptedBody && result.stableCryptoId && result.keyEpoch) {
    try {
      return withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
        decryptPlanBody({
          workspaceKey,
          workspaceOwnerId,
          stableCryptoId: result.stableCryptoId,
          keyEpoch: result.keyEpoch,
          envelope: result.encryptedBody,
        }),
      );
    } catch (caught) {
      return caught instanceof Error && caught.message === 'Obfuscation is locked'
        ? 'Obfuscation is locked. Unlock it in Account settings to read this plan.'
        : 'Encrypted content failed authentication. The ciphertext was preserved.';
    }
  }
  return result?.content ?? '';
}

/**
 * Hydrate a list-item plan with its body when running in cloud mode.
 * Local plans and optimistic editor copies already carry content and skip the fetch.
 * Used for both the primary selection and the split-view pane.
 */
export function useHydratedCloudPlan(
  mode: 'local' | 'cloud',
  plan: Plan | undefined,
): Plan | undefined {
  const needsContent = mode === 'cloud' && Boolean(plan && !plan.content);
  const content = useCloudPlanContent(needsContent && plan ? plan.id : null);

  return useMemo(() => {
    if (!plan) return undefined;
    if (mode !== 'cloud' || plan.content) return plan;
    return { ...plan, content: content ?? '' };
  }, [plan, mode, content]);
}
