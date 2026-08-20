import {
  decryptWorkspaceValue,
  encryptWorkspaceValue,
  generateStableCryptoId,
  openBytes,
  packEncryptedBlob,
  sealBytes,
  unpackEncryptedBlob,
} from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
import { withWorkspaceKey } from '../lib/obfuscation-keyring.ts';
import { useWorkspaceCryptoStatus } from './useCloudMetadataCrypto.ts';

type CommentAttachment = {
  storageId: Id<'_storage'>;
  fileName?: string;
  contentType: string;
  size: number;
  url: string;
  encrypted?: boolean;
  keyEpoch?: number;
  stableCryptoId?: string;
};

type CommentRow = {
  _id: Id<'comments'>;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  body: string;
  attachments?: CommentAttachment[];
  stableCryptoId?: string;
  keyEpoch?: number;
  encryptedComment?: unknown;
  encryptedAttachments?: unknown;
  createdAt: number;
  updatedAt?: number;
};

type PrivateComment = { body: string; authorName: string; authorAvatar?: string };
type PrivateAttachment = { stableCryptoId: string; fileName?: string; contentType: string };

export type EncryptedUpload = {
  body: Blob;
  stableCryptoId: string;
  keyEpoch: number;
  fileName: string;
  contentType: string;
};

export async function encryptCommentUpload(args: {
  file: File;
  workspaceOwnerId: string;
  keyEpoch: number;
}): Promise<EncryptedUpload> {
  const stableCryptoId = generateStableCryptoId();
  const plaintext = new Uint8Array(await args.file.arrayBuffer());
  const packed = withWorkspaceKey(args.workspaceOwnerId, (_workspaceKey, derivedKeys) =>
    packEncryptedBlob(
      sealBytes(derivedKeys.contentKey, plaintext, {
        workspaceOwnerId: args.workspaceOwnerId,
        table: 'commentAttachments',
        stableCryptoId,
        slot: 'attachment',
        keyEpoch: args.keyEpoch,
      }),
    ),
  );
  plaintext.fill(0);
  return {
    body: new Blob([packed.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }),
    stableCryptoId,
    keyEpoch: args.keyEpoch,
    fileName: args.file.name,
    contentType: args.file.type,
  };
}

export function buildEncryptedCommentWrite(args: {
  workspaceOwnerId: string;
  keyEpoch: number;
  body: string;
  authorName: string;
  authorAvatar?: string;
  attachments: PrivateAttachment[];
  stableCryptoId?: string;
}) {
  return withWorkspaceKey(args.workspaceOwnerId, (workspaceKey) => {
    const comment = encryptWorkspaceValue({
      workspaceKey,
      workspaceOwnerId: args.workspaceOwnerId,
      keyEpoch: args.keyEpoch,
      table: 'comments',
      slot: 'comment',
      stableCryptoId: args.stableCryptoId,
      value: {
        body: args.body,
        authorName: args.authorName,
        ...(args.authorAvatar ? { authorAvatar: args.authorAvatar } : {}),
      } satisfies PrivateComment,
    });
    const encryptedAttachments =
      args.attachments.length > 0
        ? encryptWorkspaceValue({
            workspaceKey,
            workspaceOwnerId: args.workspaceOwnerId,
            keyEpoch: args.keyEpoch,
            table: 'comments',
            slot: 'attachment',
            stableCryptoId: comment.stableCryptoId,
            value: args.attachments,
          }).envelope
        : undefined;
    return {
      body: '',
      clientCryptoProtocol: 1 as const,
      stableCryptoId: comment.stableCryptoId,
      keyEpoch: comment.keyEpoch,
      encryptedComment: comment.envelope,
      encryptedAttachments,
    };
  });
}

export function useEncryptedComments(planId: string, shareToken?: string) {
  const rows = useQuery(api.comments.getComments, {
    planId: planId as Id<'plans'>,
    ...(shareToken ? { token: shareToken } : {}),
  }) as CommentRow[] | undefined;
  const status = useWorkspaceCryptoStatus();
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  const decrypted = useMemo(() => {
    if (!rows) return rows;
    return rows.map((row) => {
      if (
        !row.encryptedComment ||
        !row.stableCryptoId ||
        !row.keyEpoch ||
        !status?.workspaceOwnerId
      ) {
        return row;
      }
      const { encryptedComment, encryptedAttachments, stableCryptoId, keyEpoch } = row;
      const workspaceOwnerId = status.workspaceOwnerId;
      try {
        return withWorkspaceKey(workspaceOwnerId, (workspaceKey) => {
          const comment = decryptWorkspaceValue<PrivateComment>({
            workspaceKey,
            workspaceOwnerId,
            keyEpoch,
            table: 'comments',
            slot: 'comment',
            stableCryptoId,
            envelope: encryptedComment,
          });
          const metadata = encryptedAttachments
            ? decryptWorkspaceValue<PrivateAttachment[]>({
                workspaceKey,
                workspaceOwnerId,
                keyEpoch,
                table: 'comments',
                slot: 'attachment',
                stableCryptoId,
                envelope: encryptedAttachments,
              })
            : [];
          return {
            ...row,
            ...comment,
            attachments: row.attachments?.map((attachment, index) => ({
              ...attachment,
              ...metadata[index],
              url: attachmentUrls[attachment.storageId] ?? '',
            })),
          };
        });
      } catch {
        return {
          ...row,
          authorName: 'Locked comment',
          body: 'Unlock Obfuscation to read this comment.',
          authorAvatar: undefined,
          attachments: [],
        };
      }
    });
  }, [attachmentUrls, rows, status]);

  useEffect(() => {
    if (!rows || !status?.workspaceOwnerId) return;
    const workspaceOwnerId = status.workspaceOwnerId;
    let cancelled = false;
    const created: string[] = [];
    setAttachmentUrls({});
    void Promise.all(
      rows.flatMap((row) => {
        if (!row.keyEpoch || !row.stableCryptoId) return [];
        const rowKeyEpoch = row.keyEpoch;
        const rowStableCryptoId = row.stableCryptoId;
        const encryptedAttachments = row.encryptedAttachments;
        return (row.attachments ?? []).flatMap((attachment) => {
          if (!attachment.encrypted || !attachment.stableCryptoId || !attachment.keyEpoch) {
            return [];
          }
          const attachmentStableCryptoId = attachment.stableCryptoId;
          const attachmentKeyEpoch = attachment.keyEpoch;
          return [
            (async () => {
              const response = await fetch(attachment.url);
              if (!response.ok) throw new Error('Unable to load encrypted attachment');
              const packed = new Uint8Array(await response.arrayBuffer());
              const bytes = withWorkspaceKey(workspaceOwnerId, (_workspaceKey, derivedKeys) =>
                openBytes(derivedKeys.contentKey, unpackEncryptedBlob(packed), {
                  workspaceOwnerId,
                  table: 'commentAttachments',
                  stableCryptoId: attachmentStableCryptoId,
                  slot: 'attachment',
                  keyEpoch: attachmentKeyEpoch,
                }),
              );
              const metadata = encryptedAttachments
                ? withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
                    decryptWorkspaceValue<PrivateAttachment[]>({
                      workspaceKey,
                      workspaceOwnerId,
                      keyEpoch: rowKeyEpoch,
                      table: 'comments',
                      slot: 'attachment',
                      stableCryptoId: rowStableCryptoId,
                      envelope: encryptedAttachments,
                    }),
                  )
                : [];
              const match = metadata.find(
                (candidate) => candidate.stableCryptoId === attachment.stableCryptoId,
              );
              const url = URL.createObjectURL(
                new Blob([bytes.slice().buffer as ArrayBuffer], {
                  type: match?.contentType ?? 'application/octet-stream',
                }),
              );
              bytes.fill(0);
              created.push(url);
              return [attachment.storageId, url] as const;
            })(),
          ];
        });
      }),
    )
      .then((entries) => {
        if (!cancelled) setAttachmentUrls(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [rows, status]);

  return { comments: decrypted, cryptoStatus: status };
}
