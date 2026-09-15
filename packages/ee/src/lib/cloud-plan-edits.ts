import {
  decryptPlanSummary,
  encryptPlanWrite,
  encryptWorkspaceValue,
  type CryptoEnvelopeV1,
} from '@agendex/shared/crypto';
import { assessPlanValue } from '@agendex/shared/plan-value';

interface EncryptedPlanRecord {
  ownerId: string;
  stableCryptoId?: string;
  keyEpoch?: number;
  encryptedSummary?: CryptoEnvelopeV1;
  agent: string;
  format: string;
}

interface PlanEditContext {
  workspaceKey: Uint8Array;
  workspaceOwnerId: string;
  keyEpoch: number;
  plan: EncryptedPlanRecord;
}

function readCurrentSummary(args: PlanEditContext) {
  const { plan } = args;
  if (
    plan.ownerId !== args.workspaceOwnerId ||
    !plan.stableCryptoId ||
    plan.keyEpoch !== args.keyEpoch ||
    !plan.encryptedSummary
  ) {
    throw new Error('Plan encryption changed. Reload the plan before saving.');
  }
  return decryptPlanSummary({
    workspaceKey: args.workspaceKey,
    workspaceOwnerId: args.workspaceOwnerId,
    keyEpoch: args.keyEpoch,
    stableCryptoId: plan.stableCryptoId,
    envelope: plan.encryptedSummary,
  });
}

export function buildEncryptedPlanRename(args: PlanEditContext & { title: string }) {
  const summary = readCurrentSummary(args);
  const encrypted = encryptWorkspaceValue({
    workspaceKey: args.workspaceKey,
    workspaceOwnerId: args.workspaceOwnerId,
    keyEpoch: args.keyEpoch,
    stableCryptoId: args.plan.stableCryptoId,
    table: 'plans',
    slot: 'summary',
    value: { ...summary, title: args.title },
  });
  return {
    title: '',
    clientCryptoProtocol: 1 as const,
    keyEpoch: args.keyEpoch,
    encryptedSummary: encrypted.envelope,
  };
}

export function buildEncryptedPlanContentEdit(
  args: PlanEditContext & { title: string; content: string },
) {
  const summary = readCurrentSummary(args);
  const metadata =
    summary.metadata && typeof summary.metadata === 'object' && !Array.isArray(summary.metadata)
      ? (summary.metadata as Record<string, unknown>)
      : undefined;
  const encrypted = encryptPlanWrite({
    workspaceKey: args.workspaceKey,
    workspaceOwnerId: args.workspaceOwnerId,
    keyEpoch: args.keyEpoch,
    stableCryptoId: args.plan.stableCryptoId,
    plan: {
      ...summary,
      title: args.title,
      content: args.content,
      agent: args.plan.agent,
      format: args.plan.format,
      lowValue: assessPlanValue({ title: args.title, content: args.content, metadata }).lowValue,
    },
  });
  return {
    title: '',
    content: '',
    clientCryptoProtocol: 1 as const,
    keyEpoch: args.keyEpoch,
    encryptedSummary: encrypted.encryptedSummary,
    encryptedBody: encrypted.encryptedBody,
    versionStableCryptoId: encrypted.versionStableCryptoId,
    encryptedVersionSummary: encrypted.encryptedVersionSummary,
    encryptedVersionBody: encrypted.encryptedVersionBody,
    contentToken: encrypted.contentToken,
    lowValue: encrypted.lowValue,
  };
}
