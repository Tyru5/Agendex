import { canonicalJson } from './encoding.ts';
import { openText, sealText } from './envelope.ts';
import { computeOpaqueToken, deriveWorkspaceKeys, generateStableCryptoId } from './keys.ts';
import { CryptoFormatError, type CryptoEnvelopeV1 } from './types.ts';

export interface PlaintextPlanCryptoInput {
  localPlanId: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath?: string;
  workspace?: string;
  metadata?: unknown;
  syncIdentity?: string;
  continuityIdentity?: string;
  lowValue: boolean;
}

export interface EncryptedPlanWrite {
  localPlanId: '';
  agent: string;
  title: '';
  content: '';
  format: string;
  filePath?: undefined;
  workspace?: undefined;
  metadata?: undefined;
  clientCryptoProtocol: 1;
  stableCryptoId: string;
  keyEpoch: number;
  encryptedSummary: CryptoEnvelopeV1;
  encryptedBody: CryptoEnvelopeV1;
  versionStableCryptoId: string;
  encryptedVersionSummary: CryptoEnvelopeV1;
  encryptedVersionBody: CryptoEnvelopeV1;
  contentToken: string;
  localPlanToken: string;
  syncIdentityToken?: string;
  continuityToken?: string;
  lowValue: boolean;
}

export interface DecryptedPlanSummary {
  localPlanId: string;
  title: string;
  filePath?: string;
  workspace?: string;
  metadata?: unknown;
}

function summaryJson(input: PlaintextPlanCryptoInput): string {
  return canonicalJson({
    localPlanId: input.localPlanId,
    title: input.title,
    ...(input.filePath !== undefined ? { filePath: input.filePath } : {}),
    ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

export function encryptPlanWrite(args: {
  workspaceKey: Uint8Array;
  workspaceOwnerId: string;
  keyEpoch: number;
  plan: PlaintextPlanCryptoInput;
  stableCryptoId?: string;
  versionStableCryptoId?: string;
}): EncryptedPlanWrite {
  const { contentKey, indexKey } = deriveWorkspaceKeys(args.workspaceKey);
  const stableCryptoId = args.stableCryptoId ?? generateStableCryptoId();
  const versionStableCryptoId = args.versionStableCryptoId ?? generateStableCryptoId();
  const summary = summaryJson(args.plan);
  const planContext = {
    workspaceOwnerId: args.workspaceOwnerId,
    table: 'plans' as const,
    stableCryptoId,
    keyEpoch: args.keyEpoch,
  };
  const versionContext = {
    workspaceOwnerId: args.workspaceOwnerId,
    table: 'planVersions' as const,
    stableCryptoId: versionStableCryptoId,
    keyEpoch: args.keyEpoch,
  };

  return {
    localPlanId: '',
    agent: args.plan.agent,
    title: '',
    content: '',
    format: args.plan.format,
    clientCryptoProtocol: 1,
    stableCryptoId,
    keyEpoch: args.keyEpoch,
    encryptedSummary: sealText(contentKey, summary, { ...planContext, slot: 'summary' }),
    encryptedBody: sealText(contentKey, args.plan.content, { ...planContext, slot: 'body' }),
    versionStableCryptoId,
    encryptedVersionSummary: sealText(contentKey, summary, {
      ...versionContext,
      slot: 'summary',
    }),
    encryptedVersionBody: sealText(contentKey, args.plan.content, {
      ...versionContext,
      slot: 'body',
    }),
    contentToken: computeOpaqueToken(indexKey, 'content', [
      args.plan.title,
      args.plan.content,
      args.plan.format,
    ]),
    localPlanToken: computeOpaqueToken(indexKey, 'local-plan', [args.plan.localPlanId]),
    ...(args.plan.syncIdentity
      ? {
          syncIdentityToken: computeOpaqueToken(indexKey, 'sync-identity', [
            args.plan.syncIdentity,
          ]),
        }
      : {}),
    ...(args.plan.continuityIdentity
      ? {
          continuityToken: computeOpaqueToken(indexKey, 'continuity', [
            args.plan.continuityIdentity,
          ]),
        }
      : {}),
    lowValue: args.plan.lowValue,
  };
}

export function decryptPlanSummary(args: {
  workspaceKey: Uint8Array;
  workspaceOwnerId: string;
  stableCryptoId: string;
  keyEpoch: number;
  envelope: unknown;
  table?: 'plans' | 'planVersions';
}): DecryptedPlanSummary {
  const { contentKey } = deriveWorkspaceKeys(args.workspaceKey);
  const json = openText(contentKey, args.envelope, {
    workspaceOwnerId: args.workspaceOwnerId,
    table: args.table ?? 'plans',
    stableCryptoId: args.stableCryptoId,
    slot: 'summary',
    keyEpoch: args.keyEpoch,
  });
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new CryptoFormatError('Encrypted plan summary is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CryptoFormatError('Encrypted plan summary has the wrong shape');
  }
  const summary = value as Record<string, unknown>;
  if (typeof summary.title !== 'string') {
    throw new CryptoFormatError('Encrypted plan summary is missing its title');
  }
  if (typeof summary.localPlanId !== 'string') {
    throw new CryptoFormatError('Encrypted plan summary is missing its local identity');
  }
  if (summary.filePath !== undefined && typeof summary.filePath !== 'string') {
    throw new CryptoFormatError('Encrypted plan summary has an invalid path');
  }
  if (summary.workspace !== undefined && typeof summary.workspace !== 'string') {
    throw new CryptoFormatError('Encrypted plan summary has an invalid workspace');
  }
  return {
    localPlanId: summary.localPlanId,
    title: summary.title,
    ...(summary.filePath !== undefined ? { filePath: summary.filePath } : {}),
    ...(summary.workspace !== undefined ? { workspace: summary.workspace } : {}),
    ...(summary.metadata !== undefined ? { metadata: summary.metadata } : {}),
  };
}

export function decryptPlanBody(args: {
  workspaceKey: Uint8Array;
  workspaceOwnerId: string;
  stableCryptoId: string;
  keyEpoch: number;
  envelope: unknown;
  table?: 'plans' | 'planVersions';
}): string {
  const { contentKey } = deriveWorkspaceKeys(args.workspaceKey);
  return openText(contentKey, args.envelope, {
    workspaceOwnerId: args.workspaceOwnerId,
    table: args.table ?? 'plans',
    stableCryptoId: args.stableCryptoId,
    slot: 'body',
    keyEpoch: args.keyEpoch,
  });
}
