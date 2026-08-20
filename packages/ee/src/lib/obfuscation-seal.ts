import {
  canonicalJson,
  clearBytes,
  decryptPlanBody,
  decryptPlanSummary,
  decryptWorkspaceValue,
  computeOpaqueToken,
  deriveWorkspaceKeys,
  encryptPlanWrite,
  generateStableCryptoId,
  packEncryptedBlob,
  openBytes,
  openText,
  sealBytes,
  sealText,
  unpackEncryptedBlob,
  encryptWorkspaceValue,
  type CryptoEnvelopeV1,
} from '@agendex/shared/crypto';
import { assessPlanValue } from '@agendex/shared/plan-value';
import { api } from '@convex/_generated/api';
import type { ConvexReactClient } from 'convex/react';
import { withWorkspaceKey } from './obfuscation-keyring';

type SealPhase =
  | 'plans'
  | 'planVersions'
  | 'planAnnotations'
  | 'comments'
  | 'attachments'
  | 'planLinks'
  | 'tags'
  | 'collections'
  | 'plannotatorWritebacks'
  | 'daemonHeartbeats'
  | 'avatars'
  | 'pendingUploads'
  | 'exports'
  | 'shares'
  | 'audit';

type SealRow = Record<string, unknown> & { _id: string };

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function rotateRows(
  phase: SealPhase,
  rows: SealRow[],
  sourceWorkspaceKey: Uint8Array,
  targetWorkspaceKey: Uint8Array,
  workspaceOwnerId: string,
  keyEpoch: number,
): Record<string, unknown>[] {
  const { contentKey: sourceContentKey } = deriveWorkspaceKeys(sourceWorkspaceKey);
  const { contentKey: targetContentKey, indexKey } = deriveWorkspaceKeys(targetWorkspaceKey);
  const openValue = <T>(
    row: SealRow,
    table: Parameters<typeof decryptWorkspaceValue>[0]['table'],
    slot: Parameters<typeof decryptWorkspaceValue>[0]['slot'],
    envelopeValue: unknown,
  ): T =>
    decryptWorkspaceValue<T>({
      workspaceKey: sourceWorkspaceKey,
      workspaceOwnerId,
      keyEpoch: Number(row.keyEpoch),
      table,
      slot,
      stableCryptoId: stableId(row),
      envelope: envelopeValue,
    });
  const sealValue = (
    row: SealRow,
    table: Parameters<typeof encryptWorkspaceValue>[0]['table'],
    slot: Parameters<typeof encryptWorkspaceValue>[0]['slot'],
    value: unknown,
  ) =>
    encryptWorkspaceValue({
      workspaceKey: targetWorkspaceKey,
      workspaceOwnerId,
      keyEpoch,
      table,
      slot,
      stableCryptoId: stableId(row),
      value,
    }).envelope;

  try {
    switch (phase) {
      case 'plans':
        return rows.map((row) => {
          const summary = decryptPlanSummary({
            workspaceKey: sourceWorkspaceKey,
            workspaceOwnerId,
            stableCryptoId: stableId(row),
            keyEpoch: Number(row.keyEpoch),
            envelope: row.encryptedSummary,
          });
          const content = decryptPlanBody({
            workspaceKey: sourceWorkspaceKey,
            workspaceOwnerId,
            stableCryptoId: stableId(row),
            keyEpoch: Number(row.keyEpoch),
            envelope: row.encryptedBody,
          });
          const encrypted = encryptPlanWrite({
            workspaceKey: targetWorkspaceKey,
            workspaceOwnerId,
            keyEpoch,
            stableCryptoId: stableId(row),
            plan: {
              ...summary,
              agent: String(row.agent),
              content,
              format: String(row.format),
              lowValue: row.lowValue === true,
            },
          });
          return {
            id: id(row),
            expectedUpdatedAt: Number(row.updatedAt),
            stableCryptoId: stableId(row),
            keyEpoch,
            encryptedSummary: encrypted.encryptedSummary,
            encryptedBody: encrypted.encryptedBody,
            contentToken: encrypted.contentToken,
            localPlanToken: encrypted.localPlanToken,
            syncIdentityToken: encrypted.syncIdentityToken,
            continuityToken: encrypted.continuityToken,
            lowValue: encrypted.lowValue,
          };
        });
      case 'planVersions':
        return rows.map((row) => {
          const sourceEpoch = Number(row.keyEpoch);
          const rowStableId = stableId(row);
          const summary = parsedJson(
            openText(sourceContentKey, row.encryptedSummary, {
              workspaceOwnerId,
              table: 'planVersions',
              stableCryptoId: rowStableId,
              slot: 'summary',
              keyEpoch: sourceEpoch,
            }),
          );
          const content = openText(sourceContentKey, row.encryptedBody, {
            workspaceOwnerId,
            table: 'planVersions',
            stableCryptoId: rowStableId,
            slot: 'body',
            keyEpoch: sourceEpoch,
          });
          return {
            id: id(row),
            stableCryptoId: rowStableId,
            keyEpoch,
            encryptedSummary: sealText(targetContentKey, canonicalJson(summary), {
              workspaceOwnerId,
              table: 'planVersions',
              stableCryptoId: rowStableId,
              slot: 'summary',
              keyEpoch,
            }),
            encryptedBody: sealText(targetContentKey, content, {
              workspaceOwnerId,
              table: 'planVersions',
              stableCryptoId: rowStableId,
              slot: 'body',
              keyEpoch,
            }),
          };
        });
      case 'planAnnotations':
        return rows.map((row) => ({
          id: id(row),
          stableCryptoId: stableId(row),
          keyEpoch,
          encryptedAnnotation: sealValue(
            row,
            'planAnnotations',
            'annotation',
            openValue(row, 'planAnnotations', 'annotation', row.encryptedAnnotation),
          ),
        }));
      case 'comments':
        return rows.map((row) => {
          const attachments = Array.isArray(row.attachments) ? row.attachments : [];
          let attachmentMetadata: unknown[] = [];
          if (row.encryptedAttachments) {
            try {
              attachmentMetadata = openValue(
                row,
                'comments',
                'attachment',
                row.encryptedAttachments,
              );
            } catch {
              attachmentMetadata = openValue(
                row,
                'commentAttachments',
                'attachment',
                row.encryptedAttachments,
              );
            }
          }
          const metadata = attachments.map((attachment, index) => ({
            ...recordValue(attachmentMetadata[index]),
            stableCryptoId: recordValue(attachment)?.stableCryptoId,
          }));
          return {
            id: id(row),
            stableCryptoId: stableId(row),
            keyEpoch,
            encryptedComment: sealValue(
              row,
              'comments',
              'comment',
              openValue(row, 'comments', 'comment', row.encryptedComment),
            ),
            ...(metadata.length
              ? {
                  encryptedAttachments: sealValue(row, 'comments', 'attachment', metadata),
                }
              : {}),
          };
        });
      case 'planLinks':
        return rows.map((row) => ({
          id: id(row),
          stableCryptoId: stableId(row),
          keyEpoch,
          encryptedLink: sealValue(
            row,
            'planLinks',
            'link',
            openValue(row, 'planLinks', 'link', row.encryptedLink),
          ),
        }));
      case 'tags':
        return rows.map((row) => {
          const raw = openText(sourceContentKey, row.encryptedName, {
            workspaceOwnerId,
            table: 'tags',
            stableCryptoId: stableId(row),
            slot: 'name',
            keyEpoch: Number(row.keyEpoch),
          });
          const parsed = parsedJson(raw);
          const name =
            typeof parsed === 'string' ? parsed : String(recordValue(parsed)?.name ?? '');
          return {
            id: id(row),
            stableCryptoId: stableId(row),
            keyEpoch,
            encryptedName: sealValue(row, 'tags', 'name', { name }),
            nameToken: computeOpaqueToken(indexKey, 'tag-name', [name]),
          };
        });
      case 'collections':
        return rows.map((row) => {
          const rawName = openText(sourceContentKey, row.encryptedName, {
            workspaceOwnerId,
            table: 'collections',
            stableCryptoId: stableId(row),
            slot: 'name',
            keyEpoch: Number(row.keyEpoch),
          });
          const parsedName = parsedJson(rawName);
          const name =
            typeof parsedName === 'string'
              ? parsedName
              : String(recordValue(parsedName)?.name ?? '');
          let description: string | undefined;
          if (row.encryptedDescription) {
            const parsedDescription = parsedJson(
              openText(sourceContentKey, row.encryptedDescription, {
                workspaceOwnerId,
                table: 'collections',
                stableCryptoId: stableId(row),
                slot: 'description',
                keyEpoch: Number(row.keyEpoch),
              }),
            );
            description =
              typeof parsedDescription === 'string'
                ? parsedDescription
                : optionalString(recordValue(parsedDescription)?.description);
          }
          return {
            id: id(row),
            stableCryptoId: stableId(row),
            keyEpoch,
            encryptedName: sealValue(row, 'collections', 'name', { name }),
            ...(description
              ? {
                  encryptedDescription: sealValue(row, 'collections', 'description', {
                    description,
                  }),
                }
              : {}),
            nameToken: computeOpaqueToken(indexKey, 'collection-name', [name]),
          };
        });
      case 'plannotatorWritebacks':
        return rows.map((row) => {
          const value = openValue<Record<string, unknown>>(
            row,
            'plannotatorWritebacks',
            'writeback',
            row.encryptedWriteback,
          );
          const localPlanId = String(value.localPlanId ?? '');
          return {
            id: id(row),
            stableCryptoId: stableId(row),
            keyEpoch,
            encryptedWriteback: sealValue(row, 'plannotatorWritebacks', 'writeback', value),
            localPlanToken: computeOpaqueToken(indexKey, 'local-plan', [localPlanId]),
          };
        });
      case 'daemonHeartbeats':
        return rows.map((row) => ({
          id: id(row),
          stableCryptoId: stableId(row),
          keyEpoch,
          ...(row.encryptedHostname
            ? {
                encryptedHostname: sealText(
                  targetContentKey,
                  openText(sourceContentKey, row.encryptedHostname, {
                    workspaceOwnerId,
                    table: 'daemonHeartbeats',
                    stableCryptoId: stableId(row),
                    slot: 'hostname',
                    keyEpoch: Number(row.keyEpoch),
                  }),
                  {
                    workspaceOwnerId,
                    table: 'daemonHeartbeats',
                    stableCryptoId: stableId(row),
                    slot: 'hostname',
                    keyEpoch,
                  },
                ),
              }
            : {}),
          ...(row.encryptedIpAddress
            ? {
                encryptedIpAddress: sealText(
                  targetContentKey,
                  openText(sourceContentKey, row.encryptedIpAddress, {
                    workspaceOwnerId,
                    table: 'daemonHeartbeats',
                    stableCryptoId: stableId(row),
                    slot: 'ip',
                    keyEpoch: Number(row.keyEpoch),
                  }),
                  {
                    workspaceOwnerId,
                    table: 'daemonHeartbeats',
                    stableCryptoId: stableId(row),
                    slot: 'ip',
                    keyEpoch,
                  },
                ),
              }
            : {}),
        }));
      default:
        return [];
    }
  } finally {
    clearBytes(sourceContentKey, targetContentKey, indexKey);
  }
}

export interface SealOperationSnapshot {
  id: string;
  phase: string;
  cursor?: string;
  leaseId?: string;
  processed: number;
}

function id(row: SealRow): string {
  return row._id;
}

function stableId(row: SealRow): string {
  return typeof row.stableCryptoId === 'string' ? row.stableCryptoId : generateStableCryptoId();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function envelope(value: unknown): CryptoEnvelopeV1 | undefined {
  return typeof value === 'object' && value !== null ? (value as CryptoEnvelopeV1) : undefined;
}

function sealJson(
  workspaceKey: Uint8Array,
  workspaceOwnerId: string,
  keyEpoch: number,
  table: Parameters<typeof sealText>[2]['table'],
  rowStableId: string,
  slot: Parameters<typeof sealText>[2]['slot'],
  value: unknown,
): CryptoEnvelopeV1 {
  const { contentKey } = deriveWorkspaceKeys(workspaceKey);
  return sealText(contentKey, canonicalJson(value), {
    workspaceOwnerId,
    table,
    stableCryptoId: rowStableId,
    slot,
    keyEpoch,
  });
}

async function commitBatch(
  convex: ConvexReactClient,
  phase: SealPhase,
  args: Record<string, unknown>,
): Promise<void> {
  switch (phase) {
    case 'plans':
      await convex.mutation(api.workspaceCryptoSeal.sealPlansBatch, args as never);
      break;
    case 'planVersions':
      await convex.mutation(api.workspaceCryptoSeal.sealPlanVersionsBatch, args as never);
      break;
    case 'planAnnotations':
      await convex.mutation(api.workspaceCryptoSeal.sealAnnotationsBatch, args as never);
      break;
    case 'comments':
      await convex.mutation(api.workspaceCryptoSeal.sealCommentsBatch, args as never);
      break;
    case 'attachments':
      break;
    case 'planLinks':
      await convex.mutation(api.workspaceCryptoSeal.sealLinksBatch, args as never);
      break;
    case 'tags':
      await convex.mutation(api.workspaceCryptoSeal.sealTagsBatch, args as never);
      break;
    case 'collections':
      await convex.mutation(api.workspaceCryptoSeal.sealCollectionsBatch, args as never);
      break;
    case 'plannotatorWritebacks':
      await convex.mutation(api.workspaceCryptoSeal.sealWritebacksBatch, args as never);
      break;
    case 'daemonHeartbeats':
      await convex.mutation(api.workspaceCryptoSeal.sealHeartbeatsBatch, args as never);
      break;
    case 'avatars':
      break;
    case 'pendingUploads':
    case 'exports':
      break;
    case 'shares':
      await convex.mutation(api.workspaceCryptoSeal.deleteSharesBatch, args as never);
      break;
    case 'audit':
      break;
  }
}

function encryptRows(
  phase: SealPhase,
  rows: SealRow[],
  workspaceKey: Uint8Array,
  workspaceOwnerId: string,
  keyEpoch: number,
  sourceWorkspaceKey?: Uint8Array,
): Record<string, unknown>[] {
  if (sourceWorkspaceKey) {
    return rotateRows(phase, rows, sourceWorkspaceKey, workspaceKey, workspaceOwnerId, keyEpoch);
  }
  const { contentKey, indexKey } = deriveWorkspaceKeys(workspaceKey);
  switch (phase) {
    case 'plans':
      return rows.map((row) => {
        if (envelope(row.encryptedSummary) && envelope(row.encryptedBody)) {
          return {
            id: id(row),
            expectedUpdatedAt: Number(row.updatedAt),
            stableCryptoId: stableId(row),
            keyEpoch,
            encryptedSummary: row.encryptedSummary,
            encryptedBody: row.encryptedBody,
            contentToken: String(row.contentToken),
            localPlanToken: String(row.localPlanToken),
            syncIdentityToken: optionalString(row.syncIdentityToken),
            continuityToken: optionalString(row.continuityToken),
            lowValue: row.lowValue === true,
          };
        }
        const title = String(row.title ?? '');
        const content = String(row.content ?? '');
        const encrypted = encryptPlanWrite({
          workspaceKey,
          workspaceOwnerId,
          keyEpoch,
          stableCryptoId: stableId(row),
          plan: {
            localPlanId: String(row.localPlanId ?? `cloud:${id(row)}`),
            agent: String(row.agent ?? 'unknown'),
            title,
            content,
            format: String(row.format ?? 'markdown'),
            filePath: optionalString(row.filePath),
            workspace: optionalString(row.workspace),
            metadata: row.metadata,
            syncIdentity: optionalString(row.syncIdentityKey),
            continuityIdentity: optionalString(row.plannotatorContinuityKey),
            lowValue: assessPlanValue({ title, content, metadata: recordValue(row.metadata) })
              .lowValue,
          },
        });
        return {
          id: id(row),
          expectedUpdatedAt: Number(row.updatedAt),
          stableCryptoId: encrypted.stableCryptoId,
          keyEpoch,
          encryptedSummary: encrypted.encryptedSummary,
          encryptedBody: encrypted.encryptedBody,
          contentToken: encrypted.contentToken,
          localPlanToken: encrypted.localPlanToken,
          syncIdentityToken: encrypted.syncIdentityToken,
          continuityToken: encrypted.continuityToken,
          lowValue: encrypted.lowValue,
        };
      });
    case 'planVersions':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        const summary = {
          title: String(row.title ?? ''),
          ...(row.filePath !== undefined ? { filePath: row.filePath } : {}),
          ...(row.workspace !== undefined ? { workspace: row.workspace } : {}),
          ...(row.metadata !== undefined ? { metadata: row.metadata } : {}),
        };
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          encryptedSummary:
            envelope(row.encryptedSummary) ??
            sealText(contentKey, canonicalJson(summary), {
              workspaceOwnerId,
              table: 'planVersions',
              stableCryptoId: rowStableId,
              slot: 'summary',
              keyEpoch,
            }),
          encryptedBody:
            envelope(row.encryptedBody) ??
            sealText(contentKey, String(row.content ?? ''), {
              workspaceOwnerId,
              table: 'planVersions',
              stableCryptoId: rowStableId,
              slot: 'body',
              keyEpoch,
            }),
        };
      });
    case 'planAnnotations':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          encryptedAnnotation:
            envelope(row.encryptedAnnotation) ??
            sealJson(
              workspaceKey,
              workspaceOwnerId,
              keyEpoch,
              'planAnnotations',
              rowStableId,
              'annotation',
              {
                authorName: row.authorName,
                body: row.body,
                replacementText: row.replacementText,
                anchor: row.anchor,
              },
            ),
        };
      });
    case 'comments':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        const attachments = Array.isArray(row.attachments) ? row.attachments : [];
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          encryptedComment:
            envelope(row.encryptedComment) ??
            sealJson(workspaceKey, workspaceOwnerId, keyEpoch, 'comments', rowStableId, 'comment', {
              authorName: row.authorName,
              authorAvatar: row.authorAvatar,
              body: row.body,
            }),
          ...(attachments.length > 0
            ? {
                encryptedAttachments:
                  envelope(row.encryptedAttachments) ??
                  sealJson(
                    workspaceKey,
                    workspaceOwnerId,
                    keyEpoch,
                    'commentAttachments',
                    rowStableId,
                    'attachment',
                    attachments.map((attachment) => {
                      const value = attachment as Record<string, unknown>;
                      return {
                        fileName: value.fileName,
                        contentType: value.contentType,
                        size: value.size,
                      };
                    }),
                  ),
              }
            : {}),
        };
      });
    case 'attachments':
      return [];
    case 'planLinks':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          encryptedLink:
            envelope(row.encryptedLink) ??
            sealJson(workspaceKey, workspaceOwnerId, keyEpoch, 'planLinks', rowStableId, 'link', {
              value: row.value,
              url: row.url,
            }),
        };
      });
    case 'tags':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        const name = String(row.name ?? '');
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          encryptedName:
            envelope(row.encryptedName) ??
            sealText(contentKey, name, {
              workspaceOwnerId,
              table: 'tags',
              stableCryptoId: rowStableId,
              slot: 'name',
              keyEpoch,
            }),
          nameToken:
            optionalString(row.nameToken) ??
            computeOpaqueToken(indexKey, 'tag-name', [name.toLowerCase()]),
        };
      });
    case 'collections':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        const name = String(row.name ?? '');
        const description = optionalString(row.description);
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          encryptedName:
            envelope(row.encryptedName) ??
            sealText(contentKey, name, {
              workspaceOwnerId,
              table: 'collections',
              stableCryptoId: rowStableId,
              slot: 'name',
              keyEpoch,
            }),
          ...(description !== undefined
            ? {
                encryptedDescription:
                  envelope(row.encryptedDescription) ??
                  sealText(contentKey, description, {
                    workspaceOwnerId,
                    table: 'collections',
                    stableCryptoId: rowStableId,
                    slot: 'description',
                    keyEpoch,
                  }),
              }
            : {}),
          nameToken:
            optionalString(row.nameToken) ??
            computeOpaqueToken(indexKey, 'collection-name', [name.toLowerCase()]),
        };
      });
    case 'plannotatorWritebacks':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        const localPlanId = String(row.localPlanId ?? '');
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          encryptedWriteback:
            envelope(row.encryptedWriteback) ??
            sealJson(
              workspaceKey,
              workspaceOwnerId,
              keyEpoch,
              'plannotatorWritebacks',
              rowStableId,
              'writeback',
              {
                localPlanId,
                feedback: row.feedback,
                revisedContent: row.revisedContent,
                annotations: row.annotations,
              },
            ),
          localPlanToken:
            optionalString(row.localPlanToken) ??
            computeOpaqueToken(indexKey, 'local-plan', [localPlanId]),
        };
      });
    case 'daemonHeartbeats':
      return rows.map((row) => {
        const rowStableId = stableId(row);
        const hostname = optionalString(row.hostname);
        const ipAddress = optionalString(row.ipAddress);
        return {
          id: id(row),
          stableCryptoId: rowStableId,
          keyEpoch,
          ...(hostname
            ? {
                encryptedHostname:
                  envelope(row.encryptedHostname) ??
                  sealText(contentKey, hostname, {
                    workspaceOwnerId,
                    table: 'daemonHeartbeats',
                    stableCryptoId: rowStableId,
                    slot: 'hostname',
                    keyEpoch,
                  }),
              }
            : {}),
          ...(ipAddress
            ? {
                encryptedIpAddress:
                  envelope(row.encryptedIpAddress) ??
                  sealText(contentKey, ipAddress, {
                    workspaceOwnerId,
                    table: 'daemonHeartbeats',
                    stableCryptoId: rowStableId,
                    slot: 'ip',
                    keyEpoch,
                  }),
              }
            : {}),
        };
      });
    case 'avatars':
      return [];
    case 'pendingUploads':
    case 'exports':
      return [];
    case 'shares':
    case 'audit':
      return [];
  }
}

async function uploadEncryptedBlob(args: {
  convex: ConvexReactClient;
  phase: 'attachments' | 'avatars';
  leaseId: string;
  recordId: string;
  sourceUrl: string;
  workspaceOwnerId: string;
  keyEpoch: number;
  stableCryptoId: string;
  table: 'commentAttachments' | 'agentAvatars';
  slot: 'attachment' | 'avatar';
  sourceWorkspaceKey?: Uint8Array;
  sourceKeyEpoch?: number;
}): Promise<{ storageId: string; encryptedSize: number }> {
  const response = await fetch(args.sourceUrl);
  if (!response.ok) throw new Error('Unable to read a cloud attachment for sealing');
  const sourceBytes = new Uint8Array(await response.arrayBuffer());
  const plaintext = args.sourceWorkspaceKey
    ? (() => {
        if (!args.sourceKeyEpoch) throw new Error('Encrypted blob source epoch is missing');
        const { contentKey } = deriveWorkspaceKeys(args.sourceWorkspaceKey);
        try {
          return openBytes(contentKey, unpackEncryptedBlob(sourceBytes), {
            workspaceOwnerId: args.workspaceOwnerId,
            table: args.table,
            stableCryptoId: args.stableCryptoId,
            slot: args.slot,
            keyEpoch: args.sourceKeyEpoch,
          });
        } finally {
          clearBytes(contentKey);
          sourceBytes.fill(0);
        }
      })()
    : sourceBytes;
  const packed = withWorkspaceKey(args.workspaceOwnerId, (workspaceKey) => {
    const { contentKey } = deriveWorkspaceKeys(workspaceKey);
    try {
      return packEncryptedBlob(
        sealBytes(contentKey, plaintext, {
          workspaceOwnerId: args.workspaceOwnerId,
          table: args.table,
          stableCryptoId: args.stableCryptoId,
          slot: args.slot,
          keyEpoch: args.keyEpoch,
        }),
      );
    } finally {
      clearBytes(contentKey);
    }
  });
  plaintext.fill(0);
  const uploadUrl = await args.convex.mutation(api.workspaceCryptoSeal.generateSealUploadUrl, {
    phase: args.phase,
    leaseId: args.leaseId,
    recordId: args.recordId,
  });
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: packed.slice().buffer as ArrayBuffer,
  });
  if (!upload.ok) throw new Error('Unable to upload an encrypted cloud attachment');
  const result = (await upload.json()) as { storageId?: string };
  if (!result.storageId) throw new Error('Encrypted attachment upload did not return storage');
  return { storageId: result.storageId, encryptedSize: packed.byteLength };
}

async function sealBlobRows(args: {
  convex: ConvexReactClient;
  phase: 'attachments' | 'avatars';
  leaseId: string;
  rows: SealRow[];
  workspaceOwnerId: string;
  keyEpoch: number;
  sourceWorkspaceKey?: Uint8Array;
}): Promise<number> {
  let processed = 0;
  if (args.phase === 'attachments') {
    for (const comment of args.rows) {
      const attachments = Array.isArray(comment.attachments) ? comment.attachments : [];
      for (const rawAttachment of attachments) {
        const attachment = rawAttachment as Record<string, unknown>;
        if (attachment.encrypted === true && !args.sourceWorkspaceKey) continue;
        const sourceUrl = optionalString(attachment.url);
        const oldStorageId = optionalString(attachment.storageId);
        const attachmentIndex = Number(attachment.index);
        if (!sourceUrl || !oldStorageId || !Number.isSafeInteger(attachmentIndex)) {
          throw new Error('Attachment metadata is incomplete; sealing stopped');
        }
        const attachmentStableId =
          optionalString(attachment.stableCryptoId) ?? generateStableCryptoId();
        const uploaded = await uploadEncryptedBlob({
          convex: args.convex,
          phase: 'attachments',
          leaseId: args.leaseId,
          recordId: id(comment),
          sourceUrl,
          workspaceOwnerId: args.workspaceOwnerId,
          keyEpoch: args.keyEpoch,
          stableCryptoId: attachmentStableId,
          table: 'commentAttachments',
          slot: 'attachment',
          sourceWorkspaceKey: args.sourceWorkspaceKey,
          sourceKeyEpoch: Number(attachment.keyEpoch),
        });
        await args.convex.mutation(api.workspaceCryptoSeal.commitEncryptedAttachment, {
          leaseId: args.leaseId,
          commentId: id(comment) as never,
          attachmentIndex,
          oldStorageId: oldStorageId as never,
          newStorageId: uploaded.storageId as never,
          stableCryptoId: attachmentStableId,
          keyEpoch: args.keyEpoch,
          encryptedSize: uploaded.encryptedSize,
        });
        processed++;
      }
    }
    return processed;
  }

  for (const avatar of args.rows) {
    if (avatar.encrypted === true && !args.sourceWorkspaceKey) continue;
    const sourceUrl = optionalString(avatar.url);
    const oldStorageId = optionalString(avatar.storageId);
    if (!sourceUrl || !oldStorageId)
      throw new Error('Avatar storage is unavailable; sealing stopped');
    const avatarStableId = stableId(avatar);
    const uploaded = await uploadEncryptedBlob({
      convex: args.convex,
      phase: 'avatars',
      leaseId: args.leaseId,
      recordId: id(avatar),
      sourceUrl,
      workspaceOwnerId: args.workspaceOwnerId,
      keyEpoch: args.keyEpoch,
      stableCryptoId: avatarStableId,
      table: 'agentAvatars',
      slot: 'avatar',
      sourceWorkspaceKey: args.sourceWorkspaceKey,
      sourceKeyEpoch: Number(avatar.keyEpoch),
    });
    await args.convex.mutation(api.workspaceCryptoSeal.commitEncryptedAvatar, {
      leaseId: args.leaseId,
      avatarId: id(avatar) as never,
      oldStorageId: oldStorageId as never,
      newStorageId: uploaded.storageId as never,
      stableCryptoId: avatarStableId,
      keyEpoch: args.keyEpoch,
    });
    processed++;
  }
  return processed;
}

export async function runWorkspaceSeal(args: {
  convex: ConvexReactClient;
  workspaceOwnerId: string;
  keyEpoch: number;
  operation: SealOperationSnapshot;
  onProgress?: (processed: number, phase: SealPhase) => void;
  signal?: AbortSignal;
  sourceWorkspaceKey?: Uint8Array;
}): Promise<'sealed' | 'aborted'> {
  let phase = args.operation.phase as SealPhase;
  let cursor = args.operation.cursor ?? null;
  const leaseId = args.operation.leaseId ?? crypto.randomUUID();

  await args.convex.mutation(api.workspaceCrypto.claimWorkspaceCryptoLease, {
    operationId: args.operation.id,
    leaseId,
  });

  while (true) {
    if (args.signal?.aborted) return 'aborted';
    if (phase === 'audit') {
      const audit = await args.convex.mutation(api.workspaceCryptoSeal.runWorkspaceAuditBatch, {
        leaseId,
      });
      if (audit.violations.length > 0) {
        throw new Error(
          `Obfuscation audit found ${audit.violations[0]?.category ?? 'encrypted residue'}`,
        );
      }
      if (audit.done) return 'sealed';
      continue;
    }
    const batch = await args.convex.query(api.workspaceCryptoSeal.getWorkspaceSealBatch, {
      phase,
      paginationOpts: { cursor, numItems: 20 },
    });
    const rows = batch.page as unknown as SealRow[];
    const progress = {
      leaseId,
      continueCursor: batch.continueCursor,
      isDone: batch.isDone,
    };

    if (phase === 'attachments' || phase === 'avatars') {
      const processed = await sealBlobRows({
        convex: args.convex,
        phase,
        leaseId,
        rows,
        workspaceOwnerId: args.workspaceOwnerId,
        keyEpoch: args.keyEpoch,
        sourceWorkspaceKey: args.sourceWorkspaceKey,
      });
      await args.convex.mutation(api.workspaceCryptoSeal.advanceBlobSealBatch, {
        phase,
        ...progress,
        processed,
      });
    } else if (phase === 'pendingUploads') {
      await args.convex.mutation(api.workspaceCryptoSeal.cleanupPendingUploadsBatch, {
        leaseId,
        ids: rows.map(id) as never,
      });
    } else if (phase === 'exports') {
      await args.convex.mutation(api.workspaceCryptoSeal.cleanupExportsBatch, {
        leaseId,
        ids: rows.map(id) as never,
      });
    } else if (phase === 'shares') {
      await commitBatch(args.convex, phase, { ...progress, ids: rows.map(id) });
    } else {
      const items = withWorkspaceKey(args.workspaceOwnerId, (workspaceKey) =>
        encryptRows(
          phase,
          rows,
          workspaceKey,
          args.workspaceOwnerId,
          args.keyEpoch,
          args.sourceWorkspaceKey,
        ),
      );
      await commitBatch(args.convex, phase, { ...progress, items });
    }

    args.onProgress?.(rows.length, phase);
    const status = await args.convex.query(api.workspaceCrypto.getWorkspaceCryptoStatus, {});
    const nextOperation = status?.settings?.operation;
    if (!nextOperation) return 'sealed';
    phase = nextOperation.phase as SealPhase;
    cursor = nextOperation.cursor ?? null;
  }
}
